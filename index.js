import ccxt from 'ccxt';
import pkg from 'technicalindicators';
const { EMA, RSI } = pkg;
import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.CHAT_ID;
const bot = new TelegramBot(token);

// Switching to Bybit because Binance blocks GitHub servers
const exchange = new ccxt.bybit({
    'options': { 'defaultType': 'linear' }, // Bybit Linear USDT Perpetual
    'enableRateLimit': true
});

const timeframes = ['15m', '1h', '4h', '1d'];

async function getFilteredPerpPairs() {
    try {
        console.log("Loading Bybit Markets...");
        const tickers = await exchange.fetchTickers();
        let filteredSymbols = [];
        
        for (const symbol in tickers) {
            const ticker = tickers[symbol];
            
            // Filter: USDT Perpetual, Price < 10, Volume > 1M
            if (symbol.endsWith('/USDT:USDT') && ticker.last < 10 && ticker.quoteVolume > 1000000) {
                filteredSymbols.push(symbol);
            }
        }
        
        // Sorting by Volume and picking top 60
        filteredSymbols.sort((a, b) => tickers[b].quoteVolume - tickers[a].quoteVolume);
        return filteredSymbols.slice(0, 60); 
    } catch (e) {
        console.error("Filter Error:", e.message);
        return [];
    }
}

async function analyzeCoin(symbol, timeframe) {
    try {
        const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, 100);
        if (candles.length < 50) return;

        const closePrices = candles.map(c => c[4]);
        const lastPrice = closePrices[closePrices.length - 1];

        const ema20Array = EMA.calculate({ period: 20, values: closePrices });
        const lastEma20 = ema20Array[ema20Array.length - 1];

        const rsiArray = RSI.calculate({ period: 14, values: closePrices });
        const lastRsi = rsiArray[rsiArray.length - 1];

        if (!lastEma20) return;

        let side = "";
        let emoji = "";

        if (lastPrice > lastEma20) {
            side = "LONG Opportunity";
            emoji = "🟢";
        } else if (lastPrice < lastEma20) {
            side = "SHORT Opportunity";
            emoji = "🔴";
        }

        if (side) {
            const cleanSymbol = symbol.split(':')[0].replace('/', '');
            const chartUrl = `https://www.tradingview.com/chart/?symbol=BYBIT:${cleanSymbol}.P`;
            
            const message = `
${emoji} *${side}*
--------------------------
🪙 *Coin:* #${cleanSymbol.replace('USDT', '')}
⏰ *Timeframe:* ${timeframe}
💰 *Price:* ${lastPrice}
📊 *RSI:* ${lastRsi ? lastRsi.toFixed(2) : 'N/A'}
📉 *EMA 20:* ${lastEma20.toFixed(4)}
--------------------------
🔗 [Open Chart on TradingView](${chartUrl})
            `;
            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }
    } catch (e) {}
}

async function run() {
    try {
        const coins = await getFilteredPerpPairs();
        const totalCoins = coins.length;

        if (totalCoins === 0) {
            await bot.sendMessage(chatId, "⚠️ No coins found on Bybit matching criteria.");
            return;
        }

        await bot.sendMessage(chatId, `🔍 *Bybit Scanner Started*\nFound *${totalCoins}* Active coins\nPrice < $10 | Vol > 1M\nScanning timeframes...`, { parse_mode: 'Markdown' });

        for (const tf of timeframes) {
            for (const coin of coins) {
                await analyzeCoin(coin, tf);
                await new Promise(res => setTimeout(res, 300));
            }
        }
        
        await bot.sendMessage(chatId, "✅ *Scan Completed Successfully.*");
    } catch (error) {
        console.error("Critical Error:", error.message);
    }
}

run();
