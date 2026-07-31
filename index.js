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

// Timeframes requested by you
const timeframes = ['15m', '30m', '1h', '2h', '4h', '1d', '1w'];

async function getFilteredPerpPairs() {
    try {
        const tickers = await exchange.fetchTickers();
        const markets = await exchange.loadMarkets();
        let filteredSymbols = [];
        
        for (const symbol in tickers) {
            const ticker = tickers[symbol];
            const market = markets[symbol];
            
            // Filter: USDT Perp, Price < 10 USDT, Active Market
            if (symbol.endsWith('/USDT') && market.type === 'swap' && ticker.last < 10 && market.active) {
                filteredSymbols.push(symbol);
            }
        }
        return filteredSymbols;
    } catch (e) {
        return [];
    }
}

async function analyzeCoin(symbol, timeframe) {
    try {
        const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, 50);
        if (candles.length < 21) return;

        const closePrices = candles.map(c => c[4]);
        const lastPrice = closePrices[closePrices.length - 1];

        const ema20Array = EMA.calculate({ period: 20, values: closePrices });
        const lastEma20 = ema20Array[ema20Array.length - 1];

        let signal = "";
        
        // Buy if Close is above 20 EMA
        if (lastPrice > lastEma20) {
            signal = "🚀 BULLISH (Close > 20 EMA)";
        } 
        // Sell if Close is below 20 EMA
        else if (lastPrice < lastEma20) {
            signal = "🔻 BEARISH (Close < 20 EMA)";
        }

        if (signal) {
            const message = `
Signal Alert!
Coin: ${symbol}
Timeframe: ${timeframe}
Price: ${lastPrice}
EMA 20: ${lastEma20.toFixed(4)}
Status: ${signal}
            `;
            await bot.sendMessage(chatId, message);
        }
    } catch (e) {
        // Handle errors silently
    }
}

async function run() {
    try {
        await bot.sendMessage(chatId, "Scanner Started: Checking all timeframes for 20 EMA strategy...");
        
        const coins = await getFilteredPerpPairs();
        
        for (const tf of timeframes) {
            for (const coin of coins) {
                await analyzeCoin(coin, tf);
                // 300ms delay to avoid API rate limits
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }
        
        await bot.sendMessage(chatId, "Scan Completed.");
    } catch (error) {
        console.error("Run Error:", error.message);
    }
}

run();
