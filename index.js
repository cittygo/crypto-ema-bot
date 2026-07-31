import ccxt from 'ccxt';
import pkg from 'technicalindicators';
const { EMA } = pkg;
import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.CHAT_ID;
const bot = new TelegramBot(token);

const exchange = new ccxt.binance({
    'options': { 'defaultType': 'future' },
    'enableRateLimit': true
});

const timeframes = ['2h', '4h', '1d'];

async function getFilteredPerpPairs() {
    try {
        console.log("Fetching market tickers...");
        const tickers = await exchange.fetchTickers();
        const markets = await exchange.loadMarkets();
        let filteredSymbols = [];

        for (const symbol in tickers) {
            const ticker = tickers[symbol];
            const market = markets[symbol];
            
            // Filter: USDT Perp, Price < 10, Market Active
            if (symbol.endsWith('/USDT') && market.type === 'swap' && ticker.last < 10 && market.active) {
                filteredSymbols.push(symbol);
            }
        }
        return filteredSymbols;
    } catch (e) {
        console.error("Error fetching pairs:", e.message);
        return [];
    }
}

async function analyzeCoin(symbol, timeframe) {
    try {
        const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, 100);
        if (candles.length < 50) return;

        const closePrices = candles.map(c => c[4]);
        const currentPrice = closePrices[closePrices.length - 1];

        const ema20Array = EMA.calculate({ period: 20, values: closePrices });
        const ema50Array = EMA.calculate({ period: 50, values: closePrices });

        const ema20 = ema20Array[ema20Array.length - 1];
        const ema50 = ema50Array[ema50Array.length - 1];

        if (!ema20 || !ema50) return;

        let status = "";
        if (currentPrice < ema20 && currentPrice < ema50) {
            status = "🔻 BUY SIGNAL (Price below EMA 20 & 50)";
        } else if (currentPrice > ema20 && currentPrice > ema50) {
            status = "✅ SELL SIGNAL (Price above EMA 20 & 50)";
        }

        if (status) {
            const message = `🚀 Signal Found!\nCoin: ${symbol}\nTimeframe: ${timeframe}\nPrice: ${currentPrice}\nStatus: ${status}`;
            await bot.sendMessage(chatId, message);
            console.log(`Signal sent for ${symbol} [${timeframe}]`);
        }
    } catch (e) {
        // Silently handle errors for specific symbols
    }
}

async function run() {
    try {
        // Connection Test Message
        await bot.sendMessage(chatId, "Bot started: Scanning market for EMA signals...");
        
        const coins = await getFilteredPerpPairs();
        console.log(`Scanning ${coins.length} coins...`);

        for (const tf of timeframes) {
            console.log(`Checking timeframe: ${tf}`);
            for (const coin of coins) {
                await analyzeCoin(coin, tf);
                await new Promise(resolve => setTimeout(resolve, 300)); // Delay for rate limits
            }
        }
        
        await bot.sendMessage(chatId, "Scan finished successfully.");
        console.log("Process complete.");
    } catch (error) {
        console.error("Critical Error:", error.message);
    }
}

run();
