import ccxt from 'ccxt';
import pkg from 'technicalindicators';
const { RSI } = pkg;
import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.CHAT_ID;
const bot = new TelegramBot(token);

const exchange = new ccxt.bitget({
    'options': { 'defaultType': 'swap' },
    'enableRateLimit': true
});

const timeframes = ['4h', '1d', '1w'];
const majorCoins = ['BTC/USDT', 'BNB/USDT', 'SOL/USDT', 'ETH/USDT'];

async function getFilteredPairs() {
    try {
        const tickers = await exchange.fetchTickers();
        let filtered = [];
        for (const symbol in tickers) {
            const ticker = tickers[symbol];
            const base = symbol.split(':')[0];
            const isMajor = majorCoins.includes(base);
            const isCheap = ticker.last < 10 && symbol.endsWith('USDT');

            if ((isMajor || isCheap) && ticker.quoteVolume > 100000) {
                filtered.push(symbol);
            }
        }
        filtered.sort((a, b) => tickers[b].quoteVolume - tickers[a].quoteVolume);
        return filtered.slice(0, 350);
    } catch (e) { return []; }
}

async function analyzeCoin(symbol, timeframe) {
    try {
        const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, 100);
        if (candles.length < 50) return null;

        const closePrices = candles.map(c => c[4]);
        const lastRsi = RSI.calculate({ period: 14, values: closePrices }).pop();

        if (!lastRsi) return null;

        let side = "", emoji = "", strength = "Standard", priority = 3;

        // RSI Logic
        if (lastRsi >= 10 && lastRsi <= 30) {
            side = "LONG Opportunity"; emoji = "🟢";
            if (lastRsi <= 20) { strength = "Extreme Oversold"; priority = 1; }
        } else if (lastRsi >= 70 && lastRsi <= 100) {
            side = "SHORT Opportunity"; emoji = "🔴";
            if (lastRsi >= 80) { strength = "Extreme Overbought"; priority = 1; }
        }

        if (side) {
            const base = symbol.split('/')[0];
            // Check if it's a major coin for Priority 2
            if (priority !== 1 && majorCoins.includes(`${base}/USDT`)) priority = 2;

            return {
                symbol: base,
                timeframe,
                price: closePrices[closePrices.length - 1],
                rsi: lastRsi,
                side,
                emoji,
                strength,
                priority,
                url: `https://www.tradingview.com/chart/?symbol=BINANCE:${base}USDT.P`
            };
        }
    } catch (e) {}
    return null;
}

async function run() {
    try {
        const coins = await getFilteredPairs();
        let allSignals = [];

        await bot.sendMessage(chatId, `🔍 *Advanced Scanner Started*\nPriority: 1.Extreme RSI | 2.Majors | 3.Others\nScanning ${coins.length} coins...`);

        for (const tf of timeframes) {
            for (const coin of coins) {
                const signal = await analyzeCoin(coin, tf);
                if (signal) allSignals.push(signal);
                await new Promise(res => setTimeout(res, 400));
            }
        }

        // Sorting Logic: Priority 1 (Extreme) -> 2 (Majors) -> 3 (Others)
        allSignals.sort((a, b) => a.priority - b.priority);

        if (allSignals.length === 0) {
            await bot.sendMessage(chatId, "✅ Scan complete. No signals found.");
            return;
        }

        for (const s of allSignals) {
            const msg = `
${s.emoji} *${s.side}*
--------------------------
📊 *Priority:* ${s.priority === 1 ? "🔥 EXTREME" : s.priority === 2 ? "⭐ MAJOR" : "✅ NORMAL"}
📉 *Strength:* ${s.strength}
🪙 *Coin:* #${s.symbol}
⏰ *TF:* ${s.timeframe} | 💰 *Price:* ${s.price}
📈 *RSI:* ${s.rsi.toFixed(2)}
--------------------------
🔗 [Open Binance Chart](${s.url})`;
            await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
            await new Promise(res => setTimeout(res, 500)); // Delay to avoid Telegram flood
        }

        await bot.sendMessage(chatId, `✅ Successfully sent ${allSignals.length} sorted signals.`);
    } catch (error) { console.error(error.message); }
}

run();
