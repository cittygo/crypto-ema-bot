import ccxt from 'ccxt';
import pkg from 'technicalindicators';
const { EMA, RSI } = pkg;
import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.CHAT_ID;
const bot = new TelegramBot(token);

const exchange = new ccxt.binance({
    'options': { 'defaultType': 'future' },
    'enableRateLimit': true
});

const timeframes = ['15m', '1h', '4h', '1d'];

async function getFilteredPerpPairs() {
    try {
        await exchange.loadMarkets();
        const tickers = await exchange.fetchTickers();
        let filteredSymbols = [];
        
        for (const symbol in tickers) {
            const ticker = tickers[symbol];
            
            // Fixed Filter: Check if symbol contains USDT and price < 10
            // Also adding a minimum volume filter of 5M to get active coins like in your screenshot
            if (symbol.includes('USDT') && ticker.last < 10 && ticker.quoteVolume > 5000000) {
                filteredSymbols.push(symbol);
            }
        }
        
        // Sorting by volume to get the most active coins first
        return filteredSymbols.slice(0, 50); 
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
            const chartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${cleanSymbol}P`;
            const message = `
${emoji} *${side}*
--------------------------
🪙 *Coin:* #${cleanSymbol.replace('USDT', '')}
⏰ *Timeframe:* ${timeframe}
💰 *Price:* ${lastPrice}
📊 *RSI:* ${lastRsi ? lastRsi.toFixed(2) : 'N/A'}
📉 *EMA 20:* ${lastEma20.toFixed(4)}
--------------------------
🔗 [Open Chart](${chartUrl})
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
            await bot.sendMessage(chatId, "⚠️ Still no coins found. Please check API connection.");
            return;
        }

        await bot.sendMessage(chatId, `🔍 *Scanner Started*\nFound *${totalCoins}* Active USDT-Perp coins\nPrice < $10 | Vol > 5M\nScanning...`, { parse_mode: 'Markdown' });

        for (const tf of timeframes) {
            for (const coin of coins) {
                await analyzeCoin(coin, tf);
                await new Promise(res => setTimeout(res, 500));
            }
        }
        
        await bot.sendMessage(chatId, "✅ *Scan Completed Successfully.*", { parse_mode: 'Markdown' });
    } catch (error) {
        console.error("Run Error:", error.message);
    }
}

run();
