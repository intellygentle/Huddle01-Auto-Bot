const axios = require('axios');
const ethers = require('ethers');
const fs = require('fs-extra');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  bold: "\x1b[1m"
};

const logger = {
  info: (msg) => console.log(`${colors.green}[✓] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[⚠] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[✅] ${msg}${colors.reset}`),
  loading: (msg) => console.log(`${colors.cyan}[⟳] ${msg}${colors.reset}`),
  step: (msg) => console.log(`${colors.white}[➤] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log(`---------------------------------------------`);
    console.log(`  Huddle01 Testnet Auto Bot - Simplified`);
    console.log(`---------------------------------------------${colors.reset}`);
    console.log();
  }
};

const generateRandomUserAgent = () => {
  const browsers = [
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36`,
    `Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36`,
    `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1`
  ];
  return browsers[Math.floor(Math.random() * browsers.length)];
};

const BASE_URL = 'https://huddle01.app/api/v2/platform/api/v2';
const randomUserAgent = generateRandomUserAgent();

const getHeaders = () => ({
  'accept': '*/*',
  'accept-language': 'en-US,en;q=0.7',
  'content-type': 'application/json',
  'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'User-Agent': randomUserAgent
});

const getWallet = async () => {
  try {
    const wallets = await fs.readJson('wallets.json');
    if (wallets.length === 0) {
      logger.warn('No wallets found, generating new wallet...');
      return await generateWallet();
    }
    const walletData = wallets[wallets.length - 1];
    const wallet = new ethers.Wallet(walletData.privateKey);
    logger.success(`Wallet loaded: ${wallet.address.substring(0, 6)}...${wallet.address.substring(38)}`);
    return wallet;
  } catch (error) {
    logger.warn('wallets.json not found, generating new wallet...');
    return await generateWallet();
  }
};

const generateWallet = async () => {
  const wallet = ethers.Wallet.createRandom();
  const walletData = {
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic.phrase
  };
  let wallets = [];
  try {
    wallets = await fs.readJson('wallets.json');
  } catch (error) {}
  wallets.push(walletData);
  await fs.writeJson('wallets.json', wallets, { spaces: 2 });
  return wallet;
};

const generateChallenge = async (address) => {
  try {
    logger.loading(`Generating challenge for ${address.substring(0, 6)}...${address.substring(38)}`);
    const response = await axios.post(
      `${BASE_URL}/auth/wallet/generateChallenge`,
      { walletAddress: address },
      { headers: getHeaders() }
    );
    if (!response.data.signingMessage) {
      throw new Error('signingMessage not found in challenge response');
    }
    return response.data;
  } catch (error) {
    logger.error(`Challenge generation failed: ${error.response?.data?.message || error.message}`);
    throw error;
  }
};

const signMessage = async (wallet, challenge) => {
  try {
    logger.loading('Signing authentication message...');
    const signature = await wallet.signMessage(challenge.signingMessage);
    return signature;
  } catch (error) {
    logger.error(`Signing failed: ${error.message}`);
    throw error;
  }
};

const login = async (wallet, signature) => {
  try {
    logger.loading('Logging in to Huddle01...');
    const distinctId = `01966e39-${uuidv4().slice(0, 12)}`;
    const sessionId = `01966e39-${uuidv4().slice(0, 12)}`;
    const posthogCookie = `ph_phc_3E8W7zxdzH9smLU2IQnfcElQWq1wJmPYUmGFUE75Rkx_posthog=%7B%22distinct_id%22%3A%22${distinctId}%22%2C%22%24sesid%22%3A%5B${Date.now()}%2C%22${sessionId}%22%2C${Date.now() - 10000}%5D%7D`;
    const response = await axios.post(
      `${BASE_URL}/auth/wallet/login`,
      {
        address: wallet.address,
        signature,
        chain: 'eth',
        wallet: 'metamask',
        dashboardType: 'personal'
      },
      {
        headers: {
          ...getHeaders(),
          cookie: posthogCookie
        }
      }
    );
    return { tokens: response.data.tokens, posthogCookie };
  } catch (error) {
    logger.error(`Login failed: ${error.response?.data?.message || error.message}`);
    throw error;
  }
};

const createMeetingToken = async (accessToken, displayName, posthogCookie, roomId) => {
  try {
    logger.loading('Creating meeting token...');
    const response = await axios.post(
      `${BASE_URL}/create-meeting-token`,
      {
        roomId: roomId,
        metadata: {
          displayName,
          avatarUrl: 'https://web-assets.huddle01.media/avatars/0.png'
        }
      },
      {
        headers: {
          ...getHeaders(),
          cookie: `accessToken=${accessToken}; ${posthogCookie}`,
          Referer: `https://huddle01.app/room/${roomId}/lobby`
        }
      }
    );
    return response.data.token;
  } catch (error) {
    logger.error(`Failed to create meeting token: ${error.response?.data?.message || error.message}`);
    throw error;
  }
};

const getSushiUrl = async (meetingToken) => {
  try {
    logger.loading('Getting Sushi server URL...');
    const response = await axios.get('https://apira.huddle01.media/api/v1/getSushiUrl', {
      headers: {
        ...getHeaders(),
        authorization: `Bearer ${meetingToken}`,
        Referer: 'https://huddle01.app/'
      }
    });
    return response.data.url;
  } catch (error) {
    logger.error(`Failed to get Sushi URL: ${error.response?.data?.message || error.message}`);
    throw error;
  }
};

const connectWebSocket = async (sushiUrl, meetingToken, roomId, displayName) => {
  try {
    logger.loading('Connecting to WebSocket server...');
    const wsUrl = `${sushiUrl}/ws?token=${meetingToken}&version=core@2.3.5,react@2.3.6®ion=AFR&country=NG`; // Hardcoded region/country
    const ws = new WebSocket(wsUrl, {
      headers: {
        'accept-language': 'en-US,en;q=0.7',
        'sec-websocket-key': Buffer.from(uuidv4()).toString('base64'),
        'sec-websocket-version': '13',
        'User-Agent': randomUserAgent
      }
    });

    return new Promise((resolve, reject) => {
      ws.on('open', () => {
        logger.success('Connected to Huddle01 WebSocket');
        let joined = false;
        let joinTimeout = setTimeout(() => {
          if (!joined) {
            logger.warn('Timed out waiting for join confirmation, proceeding anyway');
          }
          resolve(ws);
        }, 20000);

        ws.on('message', (data) => {
          const message = data.toString();
          logger.info(`WebSocket message received: ${message}`);
          try {
            const jsonMsg = JSON.parse(message);
            if (jsonMsg.type === 'peer-join' || 
                (jsonMsg.type === 'cmd' && jsonMsg.data && jsonMsg.data.name === 'join-room-done')) {
              logger.success(`Successfully joined room ${roomId} as ${displayName}! 🎉`);
              joined = true;
              clearTimeout(joinTimeout);
              resolve(ws);
            }
          } catch (e) {
            logger.error(`Error parsing WebSocket message: ${e.message}`);
          }
        });

        ws.on('error', (error) => {
          logger.error(`WebSocket error: ${error.message}`);
          reject(error);
        });

        ws.on('close', (code, reason) => {
          logger.warn(`WebSocket closed with code ${code}, reason: ${reason || 'unknown'}`);
        });
      });

      ws.on('error', (error) => {
        logger.error(`WebSocket connection failed: ${error.message}`);
        reject(error);
      });
    });
  } catch (error) {
    logger.error(`WebSocket setup failed: ${error.message}`);
    throw error;
  }
};

const sendJoinRoomMessages = (ws, roomId, displayName) => {
  try {
    logger.loading(`Sending join room request for ${roomId}...`);
    const joinMessage = JSON.stringify({
      type: 'cmd',
      data: {
        name: 'join-room',
        payload: {
          roomId: roomId,
          role: 'peer',
          displayName: displayName
        }
      }
    });
    ws.send(joinMessage);

    setTimeout(() => {
      logger.loading('Enabling audio...');
      const enableAudioMessage = JSON.stringify({
        type: 'cmd',
        data: {
          name: 'enable-audio',
          payload: {}
        }
      });
      ws.send(enableAudioMessage);
      logger.success('Audio enabled');

      logger.loading('Enabling video...');
      const enableVideoMessage = JSON.stringify({
        type: 'cmd',
        data: {
          name: 'enable-video',
          payload: {}
        }
      });
      ws.send(enableVideoMessage);
      logger.success('Video enabled');
    }, 2000);

    return true;
  } catch (error) {
    logger.error(`Failed to send join messages: ${error.message}`);
    return false;
  }
};

const joinMeeting = async (roomId, displayName) => {
  try {
    logger.banner();
    logger.info(`Joining room ${roomId} as ${displayName}`);

    logger.step('Loading wallet...');
    const wallet = await getWallet();

    logger.step('Authenticating...');
    const challenge = await generateChallenge(wallet.address);
    const signature = await signMessage(wallet, challenge);
    const { tokens, posthogCookie } = await login(wallet, signature);
    logger.success('Authentication successful ✅');

    logger.step('Preparing to join meeting...');
    const meetingToken = await createMeetingToken(tokens.accessToken, displayName, posthogCookie, roomId);
    logger.success('Meeting token created');

    const sushiUrl = await getSushiUrl(meetingToken);
    logger.success('Server connection ready');

    logger.step('Connecting to room...');
    const ws = await connectWebSocket(sushiUrl, meetingToken, roomId, displayName);
    sendJoinRoomMessages(ws, roomId, displayName);

    console.log();
    logger.success(`Bot is now active in the meeting 🎯`);
    logger.info(`Collecting testnet participation points...`);
    console.log(`${colors.yellow}Press Ctrl+C to exit${colors.reset}`);

    process.on('SIGINT', () => {
      console.log();
      logger.warn('Closing WebSocket connection and exiting...');
      ws.close();
      logger.success('Thanks for using Huddle01 Testnet Auto Bot! 👋');
      process.exit();
    });
  } catch (error) {
    logger.error(`Error in joinMeeting: ${error.response?.data?.message || error.message}`);
    console.error(`${colors.red}Error stack: ${error.stack}${colors.reset}`);
  }
};

const startBot = () => {
  logger.banner();
  console.log(`${colors.white}Welcome to the Huddle01 Testnet Auto Bot!${colors.reset}`);
  console.log(`${colors.white}This bot joins Huddle01 meetings to collect testnet points.${colors.reset}`);
  console.log();

  rl.question(`${colors.cyan}Enter room ID (e.g., cem-xcjl-hmj): ${colors.reset}`, (roomId) => {
    rl.question(`${colors.cyan}Enter display name: ${colors.reset}`, (displayName) => {
      rl.close();
      joinMeeting(roomId, displayName);
    });
  });
};

startBot();
