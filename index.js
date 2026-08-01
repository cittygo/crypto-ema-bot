import ccxt from 'ccxt';
import pkg from 'technicalindicators';
const { EMA, RSI } = pkg;
import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.CHAT_ID;
const bot = new TelegramBot(token);

const exchange = new ccxt.bitget({
    'options': { 'defaultType': 'swap' },
    'enableRateLimit': true
});

const timeframes = ['15m', '1h', '4h', '1d'];

async function getFilteredPerpPairs() {
    try {
        const tickers = await exchange.fetchTickers();
        let filteredSymbols = [];
        for (const symbol in tickers) {
            const ticker = tickers[symbol];
            if (symbol.endsWith('USDT') && ticker.last < 10 && ticker.quoteVolume > 1000000) {
                filteredSymbols.push(symbol);
            }
        }
        filteredSymbols.sort((a, b) => tickers[b].quoteVolume - tickers[a].quoteVolume);
        return filteredSymbols.slice(0, 100); 
    } catch (e) { return []; }
}

async function analyzeCoin(symbol, timeframe) {
    let found = false;
    try {
        const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, 100);
        if (candles.length < 50) return false;

        const closePrices = candles.map(c => c[4]);
        const lastPrice = closePrices[closePrices.length - 1];
        const lastEma20 = EMA.calculate({ period: 20, values: closePrices }).pop();
        const lastRsi = RSI.calculate({ period: 14, values: closePrices }).pop();

        if (!lastEma20 || !lastRsi) return false;

        let side = "", emoji = "", quality = "";
        if (lastPrice > lastEma20 && lastRsi <= 70) {
            side = "LONG Opportunity"; emoji = "🟢";
            if (lastRsi >= 30 && lastRsi <= 45) quality = "🔥 BEST LONG ENTRY";
        } else if (lastPrice < lastEma20 && lastRsi >= 30) {
            side = "SHORT Opportunity"; emoji = "🔴";
            if (lastRsi >= 55 && lastRsi <= 70) quality = "🔥 BEST SHORT ENTRY";
        }

        if (side) {
            const base = symbol.split('/')[0];
            const url = `https://www.tradingview.com/chart/?symbol=BINANCE:${base}USDT.P`;
            const msg = `${emoji} *${side}*\n${quality ? quality + '\n' : ''}--------------------------\n🪙 *Coin:* #${base}\n⏰ *TF:* ${timeframe} | 💰 *Price:* ${lastPrice}\n📊 *RSI:* ${lastRsi.toFixed(2)}\n--------------------------\n🔗 [Open Binance Chart](${url})`;
            await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
            return true;
        }
    } catch (e) {}
    return false;
}

async function run() {
    try {
        const coins = await getFilteredPerpPairs();
        let totalSignals = 0;
        
        // Removed start message to keep it clean, only alerts if signals found.
        // But we will add a final status message to confirm the run.

        for (const tf of timeframes) {
            for (const coin of coins) {
                const signalFound = await analyzeCoin(coin, tf);
                if (signalFound) totalSignals++;
                await new Promise(res => setTimeout(res, 400));
            }
        }
        
        if (totalSignals === 0) {
            await bot.sendMessage(chatId, "✅ Scan complete: No signals matched the strategy this time.");
        } else {
            await bot.sendMessage(chatId, `✅ Scan complete: Found ${totalSignals} signals.`);
        }
    } catch (error) { console.error(error.message); }
}

run();
