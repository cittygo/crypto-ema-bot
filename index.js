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
            // Price < 10, Volume > 1M
            if (symbol.endsWith('USDT') && ticker.last < 10 && ticker.quoteVolume > 1000000) {
                filteredSymbols.push(symbol);
            }
        }
        filteredSymbols.sort((a, b) => tickers[b].quoteVolume - tickers[a].quoteVolume);
        return filteredSymbols.slice(0, 100); 
    } catch (e) { return []; }
}

async function analyzeCoin(symbol, timeframe) {
    try {
        const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, 100);
        if (candles.length < 50) return false;

        const closePrices = candles.map(c => c[4]);
        const lastPrice = closePrices[closePrices.length - 1];
        const lastEma20 = EMA.calculate({ period: 20, values: closePrices }).pop();
        const lastRsi = RSI.calculate({ period: 14, values: closePrices }).pop();

        if (!lastEma20 || !lastRsi) return false;

        let side = "", emoji = "", quality = "";

        // STRATEGY: RSI 20-30 for BUY | RSI 70-100 for SELL
        if (lastPrice > lastEma20 && lastRsi >= 20 && lastRsi <= 30) {
            side = "LONG Opportunity";
            emoji = "🟢";
            quality = "🔥 STRONG BUY (Oversold RSI 20-30)";
        } 
        else if (lastPrice < lastEma20 && lastRsi >= 70 && lastRsi <= 100) {
            side = "SHORT Opportunity";
            emoji = "🔴";
            quality = "🔥 STRONG SELL (Overbought RSI 70-100)";
        }

        if (side) {
            const base = symbol.split('/')[0];
            const url = `https://www.tradingview.com/chart/?symbol=BINANCE:${base}USDT.P`;
            const msg = `${emoji} *${side}*\n${quality}\n--------------------------\n🪙 *Coin:* #${base}\n⏰ *TF:* ${timeframe} | 💰 *Price:* ${lastPrice}\n📊 *RSI:* ${lastRsi.toFixed(2)}\n📉 *EMA 20:* ${lastEma20.toFixed(4)}\n--------------------------\n🔗 [Open Binance Chart](${url})`;
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

        for (const tf of timeframes) {
            for (const coin of coins) {
                const signalFound = await analyzeCoin(coin, tf);
                if (signalFound) totalSignals++;
                await new Promise(res => setTimeout(res, 400));
            }
        }
        
        // Final Status Message (Heartbeat) to confirm the bot is working
        const statusMsg = totalSignals === 0 
            ? "✅ Scan complete: No signals (RSI 20-30 or 70-100) found." 
            : `✅ Scan complete: Found ${totalSignals} high-quality signals.`;
        
        await bot.sendMessage(chatId, statusMsg);
    } catch (error) {
        console.error("Run Error:", error.message);
    }
}

run();
