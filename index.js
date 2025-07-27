import blessed from 'blessed';
import axios from 'axios';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import cfonts from 'cfonts';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class ExnusMiner {
  constructor(walletAddress, privateKeyBytes, proxy = null, id) {
    this.walletAddress = walletAddress;
    this.privateKeyBytes = privateKeyBytes;
    this.proxy = proxy;
    this.id = id;
    this.userInfo = {};
    this.status = 'Idle';
    this.nextMining = '-';
    this.totalPoints = 0;
    this.rank = 0;
    this.ipAddress = 'N/A';
    this.miningEndTime = null;
    this.countdownInterval = null;
    this.uiScreen = null;
    this.accountPane = null;
    this.logPane = null;
    this.isDisplayed = false;
    this.logs = [];
  }

  async start() {
    this.addLog(chalk.yellow('Starting Miner initialization'));
    await this.fetchIpAddress();
    await this.fetchUserInfo();
    await this.startMining();
    this.startUserInfoRefresh();
    this.addLog(chalk.green('Miner initialization Completed'));
  }

  async fetchIpAddress() {
    try {
      let config = {
        headers: {
          'user-agent': this.getRandomUserAgent(),
          'accept': 'application/json, text/plain, */*',
        },
      };
      if (this.proxy) {
        const agent = this.proxy.type === 'socks5' ? new SocksProxyAgent(this.proxy.url) : new HttpsProxyAgent(this.proxy.url);
        config = { ...config, httpsAgent: agent, httpAgent: agent };
      } else {
        this.addLog(chalk.yellow('No proxy configured'));
      }
      const response = await axios.get('https://api.ipify.org?format=json', config);
      this.ipAddress = response.data.ip;
    } catch (error) {
      this.ipAddress = 'Unknown';
      this.addLog(chalk.red(`Failed to fetch IP: ${error.message}`));
    }
  }

  getHeaders() {
    return {
      'accept': 'application/json',
      'content-type': 'application/json',
      'user-agent': this.getRandomUserAgent(),
    };
  }

  async fetchUserInfo() {
    try {
      const response = await axios.get(`https://points.exnus.org/api/user/${this.walletAddress}`, {
        headers: this.getHeaders(),
        ...(this.proxy ? {
          httpsAgent: this.proxy.type === 'socks5' ? new SocksProxyAgent(this.proxy.url) : new HttpsProxyAgent(this.proxy.url),
          httpAgent: this.proxy.type === 'socks5' ? new SocksProxyAgent(this.proxy.url) : new HttpsProxyAgent(this.proxy.url),
        } : {}),
      });
      const data = response.data;
      this.userInfo = data;
      this.totalPoints = data.points || 0;
      this.rank = data.rank || 0;
      this.miningEndTime = data.miningEndTime || null;
      if (this.miningEndTime && this.miningEndTime > Date.now()) {
        this.status = 'Mining Active';
        this.nextMining = this.formatTime(this.miningEndTime - Date.now());
        this.startCountdown();
      } else {
        this.status = 'Idle';
        this.nextMining = '-';
        if (this.countdownInterval) clearInterval(this.countdownInterval);
      }
      this.addLog(chalk.green('User info fetched successfully'));
      this.refreshDisplay();
    } catch (error) {
      this.addLog(chalk.red(`Failed to fetch user info: ${error.message}`));
      if (error.response && error.response.status === 401) {
        this.addLog(chalk.red('Unauthorized access (401)'));
        this.status = 'Error';
      }
      this.refreshDisplay();
    }
  }

  async startMining() {
    if (this.status === 'Mining Active') {
      this.addLog(chalk.green('Mining is already active'));
      this.startCountdown();
      this.refreshDisplay();
      return;
    }
    this.addLog(chalk.yellow('Mining is not active, attempting to start'));
    try {
      const message = 'Activate mining session for Exnus Point';
      const messageBytes = new TextEncoder().encode(message);
      const signature = nacl.sign.detached(messageBytes, this.privateKeyBytes);
      const payload = { activateMining: true };

      const response = await axios.post(`https://points.exnus.org/api/user/${this.walletAddress}`, payload, {
        headers: this.getHeaders(),
        ...(this.proxy ? {
          httpsAgent: this.proxy.type === 'socks5' ? new SocksProxyAgent(this.proxy.url) : new HttpsProxyAgent(this.proxy.url),
          httpAgent: this.proxy.type === 'socks5' ? new SocksProxyAgent(this.proxy.url) : new HttpsProxyAgent(this.proxy.url),
        } : {}),
      });

      const data = response.data;
      this.userInfo = data;
      this.totalPoints = data.points || 0;
      this.rank = data.rank || 0;
      this.miningEndTime = data.miningEndTime || null;
      this.status = 'Mining Active';
      this.nextMining = this.formatTime(this.miningEndTime - Date.now());
      this.addLog(chalk.green('Mining Activated successfully'));
      this.startCountdown();
      this.refreshDisplay();
    } catch (error) {
      this.addLog(chalk.red(`Failed to start mining: ${error.message}`));
      if (error.response && error.response.data.error === 'Mining session already active') {
        this.addLog(chalk.yellow('Mining Session Already Active'));
        await this.fetchUserInfo();
      } else if (error.response && error.response.data.error === 'You must sign the message to activate mining') {
        this.addLog(chalk.red('Signature validation failed on server'));
        this.status = 'Error';
      } else if (error.response && error.response.status === 401) {
        this.addLog(chalk.red('Unauthorized access (401)'));
        this.status = 'Error';
      }
      this.refreshDisplay();
    }
  }

  startCountdown() {
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    this.countdownInterval = setInterval(async () => {
      if (this.miningEndTime && this.miningEndTime > Date.now()) {
        this.nextMining = this.formatTime(this.miningEndTime - Date.now());
      } else {
        this.nextMining = '-';
        this.status = 'Idle';
        this.miningEndTime = null;
        this.addLog(chalk.yellow('Mining period completed, attempting to start mining again'));
        await this.startMining();
      }
      this.refreshDisplay();
    }, 1000);
  }

  startUserInfoRefresh() {
    setInterval(() => {
      this.fetchUserInfo();
    }, 60 * 60 * 1000);
  }

  formatTime(millis) {
    const seconds = Math.floor(millis / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}h ${minutes}m ${secs}s`;
  }

  getRandomUserAgent() {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 OPR/119.0.0.0 (Edition cdf)',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  addLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${chalk.cyanBright(`[Account ${this.id}]`)} ${message.replace(/\{[^}]+\}/g, '')}`;
    this.logs.push(logMessage);
    if (this.logs.length > 100) this.logs.shift();
    if (this.logPane && this.isDisplayed) {
      this.logPane.setContent(this.logs.join('\n'));
      this.logPane.setScrollPerc(100);
      this.uiScreen.render();
    }
  }

  refreshDisplay() {
    if (!this.isDisplayed || !this.accountPane || !this.logPane) return;
    const statusColor = this.status === 'Mining Active' ? 'green' : this.status === 'Error' ? 'red' : 'yellow';
    const info = `
 Wallet Address: {magenta-fg}${this.walletAddress}{/magenta-fg}
 Total Points  : {green-fg}${this.totalPoints}{/green-fg}
 Rank          : {green-fg}${this.rank}{/green-fg}
 Status        : {${statusColor}-fg}${this.status}{/}
${this.status === 'Mining Active' ? ` Next Mining   : {yellow-fg}${this.nextMining}{/yellow-fg}` : ''}
 IP Address    : {cyan-fg}${this.ipAddress}{/cyan-fg}
 Proxy         : {cyan-fg}${this.proxy ? `${this.proxy.url}` : 'None'}{/cyan-fg}
    `;
    this.accountPane.setContent(info);
    this.logPane.setContent(this.logs.join('\n'));
    this.logPane.setScrollPerc(100);
    this.uiScreen.render();
  }

  static async loadPrivateKeys() {
    const privateKeys = [];
    try {
      const filePath = path.join(__dirname, 'pk.txt');
      const data = await fs.readFile(filePath, 'utf8');
      const lines = data.split('\n')
        .map(line => line.trim())
        .filter(line => line !== '');
      for (const [index, line] of lines.entries()) {
        try {
          const privateKeyBytes = bs58.decode(line);
          const keypair = Keypair.fromSecretKey(privateKeyBytes);
          const walletAddress = keypair.publicKey.toBase58();
          privateKeys.push({ id: index + 1, walletAddress, privateKeyBytes });
        } catch (error) {
          privateKeys.push({ error: `Invalid private key at line ${index + 1}: ${error.message}` });
        }
      }
      if (!privateKeys.filter(p => !p.error).length) {
        privateKeys.push({ error: 'No valid private keys found in pk.txt.' });
      }
      return privateKeys;
    } catch (error) {
      privateKeys.push({ error: `Failed to read pk.txt: ${error.message}` });
      return privateKeys;
    }
  }

  static async loadProxies() {
    const proxies = [];
    try {
      const filePath = path.join(__dirname, 'proxy.txt');
      const data = await fs.readFile(filePath, 'utf8');
      const lines = data.split('\n')
        .map(line => line.trim())
        .filter(line => line !== '');
      for (const line of lines) {
        const proxyRegex = /^(socks5|http|https):\/\/(?:([^:@]+):([^@]+)@)?([^:]+):(\d+)$/i;
        const match = line.match(proxyRegex);
        if (!match) {
          proxies.push({ error: `Invalid proxy format: ${line}. Expected 'socks5://[user:pass@]host:port' or 'http(s)://[user:pass@]host:port', skipping.` });
          continue;
        }
        const [, scheme, username, password, host, port] = match;
        const type = scheme.toLowerCase() === 'socks5' ? 'socks5' : 'http';
        const auth = username && password ? `${username}:${password}@` : '';
        const url = `${scheme}://${auth}${host}:${port}`;
        proxies.push({ type, url });
      }
      if (!proxies.filter(p => !p.error).length) {
        proxies.push({ error: 'No valid proxies found in proxy.txt. Running without proxy.' });
      }
      return proxies;
    } catch (error) {
      proxies.push({ error: `Failed to read proxy.txt: ${error.message}. Running without proxy.` });
      return proxies;
    }
  }
}

async function main() {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'Exnus Auto Mining',
  });

  const headerPane = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: 7,
    tags: true,
    align: 'left',
  });
  screen.append(headerPane);

  function renderBanner() {
    const threshold = 80;
    const margin = Math.max(screen.width - 80, 0);
    let art = "";
    if (screen.width >= threshold) {
      art = cfonts.render('EXNUS MINER', {
        font: 'block',
        align: 'center',
        colors: ['cyan', 'magenta'],
        background: 'transparent',
        letterSpacing: 1,
        lineHeight: 1,
        space: true,
        maxLength: screen.width - margin,
      }).string;
    } else {
      art = cfonts.render('EXNUS MINER', {
        font: 'tiny',
        align: 'center',
        colors: ['cyan', 'magenta'],
        background: 'transparent',
        letterSpacing: 1,
        lineHeight: 1,
        space: true,
        maxLength: screen.width - margin,
      }).string;
    }
    headerPane.setContent(art + '\n');
    headerPane.height = Math.min(8, art.split('\n').length + 2);
  }
  renderBanner();

  const channelPane2 = blessed.box({
    top: '28%',
    left: 2,
    width: '100%',
    height: 2,
    tags: false,
    align: 'center',
  });
  channelPane2.setContent('✪ BOT EXNUS AUTO MINING ✪');
  screen.append(channelPane2);

  const infoPane = blessed.box({
    bottom: 0,
    left: 'center',
    width: '100%',
    height: 2,
    tags: true,
    align: 'center',
  });
  screen.append(infoPane);

  const dashTop = headerPane.height + channelPane2.height;
  const accountPane = blessed.box({
    top: dashTop,
    left: 0,
    width: '50%',
    height: '60%',
    border: { type: 'line' },
    label: ' User Info ',
    tags: true,
    style: { border: { fg: 'cyan' }, fg: 'white', bg: 'default' },
  });
  screen.append(accountPane);

  const logPane = blessed.log({
    top: dashTop,
    left: '50%',
    width: '50%',
    height: '60%',
    border: { type: 'line' },
    label: ' System Logs ',
    tags: true,
    style: { border: { fg: 'magenta' }, fg: 'white', bg: 'default' },
    scrollable: true,
    scrollbar: { bg: 'blue', fg: 'white' },
    alwaysScroll: true,
    mouse: true,
    keys: true,
  });
  screen.append(logPane);

  logPane.on('keypress', (ch, key) => {
    if (key.name === 'up') {
      logPane.scroll(-1);
      screen.render();
    } else if (key.name === 'down') {
      logPane.scroll(1);
      screen.render();
    } else if (key.name === 'pageup') {
      logPane.scroll(-10);
      screen.render();
    } else if (key.name === 'pagedown') {
      logPane.scroll(10);
      screen.render();
    }
  });

  logPane.on('mouse', (data) => {
    if (data.action === 'wheelup') {
      logPane.scroll(-2);
      screen.render();
    } else if (data.action === 'wheeldown') {
      logPane.scroll(2);
      screen.render();
    }
  });

  let privateKeys = await ExnusMiner.loadPrivateKeys();
  let proxies = await ExnusMiner.loadProxies();
  let activeIndex = 0;
  let miners = [];

  function updateMiners() {
    miners.forEach(miner => {
      if (miner.countdownInterval) clearInterval(miner.countdownInterval);
    });
    miners = privateKeys.map((pk, idx) => {
      const proxyEntry = proxies[idx % proxies.length] || null;
      const proxy = proxyEntry && !proxyEntry.error ? { ...proxyEntry } : null;
      const miner = new ExnusMiner(pk.walletAddress, pk.privateKeyBytes, proxy, pk.id);
      miner.uiScreen = screen;
      miner.accountPane = accountPane;
      miner.logPane = logPane;
      if (proxyEntry && proxyEntry.error) {
        miner.addLog(chalk.yellow(proxyEntry.error));
      }
      return miner;
    });

    if (miners.length > 0) {
      miners[activeIndex].isDisplayed = true;
      miners[activeIndex].addLog(chalk.magentaBright('Miner Initialized Successfully'));
      miners[activeIndex].refreshDisplay();
      miners.forEach(miner => miner.start());
    } else {
      logPane.setContent('No valid private keys found in pk.txt.\nPress \'q\' or Ctrl+C to exit.');
      accountPane.setContent('');
      screen.render();
    }
  }

  updateMiners();

  if (!miners.length) {
    screen.key(['escape', 'q', 'C-c'], () => {
      screen.destroy();
      process.exit(0);
    });
    screen.render();
    return;
  }

  infoPane.setContent(`Current Account: ${miners.length > 0 ? activeIndex + 1: 0}/${miners.length} | Use Left/Right arrow keys to switch accounts.`);

  screen.key(['escape', 'q', 'C-c'], () => {
    miners.forEach(miner => {
      if (miner.countdownInterval) clearInterval(miner.countdownInterval);
      miner.addLog(chalk.yellow('Miner stopped'));
    });
    screen.destroy();
    process.exit(0);
  });

  screen.key(['right'], () => {
    if (miners.length === 0) return;
    miners[activeIndex].isDisplayed = false;
    activeIndex = (activeIndex + 1) % miners.length;
    miners[activeIndex].isDisplayed = true;
    miners[activeIndex].refreshDisplay();
    infoPane.setContent(`Current Account: ${activeIndex + 1}/${miners.length} | Use Left/Right arrow keys to switch accounts.`);
    screen.render();
  });

  screen.key(['left'], () => {
    if (miners.length === 0) return;
    miners[activeIndex].isDisplayed = false;
    activeIndex = (activeIndex - 1 + miners.length) % miners.length;
    miners[activeIndex].isDisplayed = true;
    miners[activeIndex].refreshDisplay();
    infoPane.setContent(`Current Account: ${activeIndex + 1}/${miners.length} | Use Left/Right arrow keys to switch accounts.`);
    screen.render();
  });

  screen.key(['tab'], () => {
    logPane.focus();
    screen.render();
  });

  screen.on('resize', () => {
    renderBanner();
    headerPane.width = '100%';
    channelPane2.top = headerPane.height;
    accountPane.top = dashTop;
    logPane.top = dashTop;
    screen.render();
  });

  screen.render();
}

main().catch(error => {
  console.error(`[ERROR] Failed to start: ${error.message}`);
  const screen = blessed.screen({ smartCSR: true, title: 'NT EXHAUST' });
  const logPane = blessed.box({
    top: 'center',
    left: 'center',
    width: '80%',
    height: '100%',
    border: { type: 'line' },
    label: ' System Logs ',
    content: `Failed to start: ${error.message}\nPlease fix the issue and restart.\nPress 'q' or Ctrl+C to exit`,
    style: { border: { fg: 'red' }, fg: 'blue', bg: 'default' },
  });
  screen.append(logPane);
  screen.key(['escape', 'q', 'C-c'], () => {
    screen.destroy();
    process.exit(0);
  });
  screen.render();
});