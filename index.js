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

const timeframes = ['15m', '2h', '4h', '1d', '1w'];

async function getFilteredPerpPairs() {
    try {
        const tickers = await exchange.fetchTickers();
        let filteredSymbols = [];
        for (const symbol in tickers) {
            const ticker = tickers[symbol];
            // Filter: Price < 10 USDT and Volume > 1M
            if (symbol.endsWith('USDT') && ticker.last < 10 && ticker.quoteVolume > 1000000) {
                filteredSymbols.push(symbol);
            }
        }
        // Sorting by volume and picking TOP 200 coins
        filteredSymbols.sort((a, b) => tickers[b].quoteVolume - tickers[a].quoteVolume);
        return filteredSymbols.slice(0, 200); 
    } catch (e) { return []; }
}

async function analyzeCoin(symbol, timeframe) {
    try {
        const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, 100);
        if (candles.length < 60) return false;

        const closePrices = candles.map(c => c[4]);
        const lastPrice = closePrices[closePrices.length - 1];

        const ema20Arr = EMA.calculate({ period: 20, values: closePrices });
        const rsiArr = RSI.calculate({ period: 14, values: closePrices });

        const lastEma20 = ema20Arr[ema20Arr.length - 1];
        const lastRsi = rsiArr[rsiArr.length - 1];

        if (!lastEma20 || !lastRsi) return false;

        let signals = [];
        let side = "";
        let emoji = "";

        // --- RSI Independent Rules (Priority) ---
        if (lastRsi >= 10 && lastRsi <= 30) {
            side = "LONG Opportunity";
            emoji = "🟢";
            signals.push("🔥 STRONG BUY: RSI is 10-30 (Deep Oversold)");
        } else if (lastRsi >= 70 && lastRsi <= 100) {
            side = "SHORT Opportunity";
            emoji = "🔴";
            signals.push("🔥 STRONG SELL: RSI is 70-100 (Extreme Overbought)");
        }

        // --- EMA Independent Rules ---
        if (lastPrice > lastEma20 && side !== "SHORT Opportunity") {
            side = "LONG Opportunity";
            emoji = "🟢";
            signals.push("Price is above EMA 20");
        } else if (lastPrice < lastEma20 && side !== "LONG Opportunity") {
            side = "SHORT Opportunity";
            emoji = "🔴";
            signals.push("Price is below EMA 20");
        }

        if (signals.length > 0) {
            const baseAsset = symbol.split('/')[0]; 
            const binanceChartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${baseAsset}USDT.P`;
            
            const message = `
${emoji} *${side}*
--------------------------
🔔 *Triggered Rules:*
${signals.map(s => "✅ " + s).join("\n")}
--------------------------
🪙 *Coin:* #${baseAsset}
⏰ *TF:* ${timeframe}
💰 *Price:* ${lastPrice}
📊 *RSI:* ${lastRsi.toFixed(2)}
📉 *EMA 20:* ${lastEma20.toFixed(4)}
--------------------------
🔗 [Open Binance Chart](${binanceChartUrl})`;
            
            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            return true;
        }
    } catch (e) {}
    return false;
}

async function run() {
    try {
        const coins = await getFilteredPerpPairs();
        let totalSignals = 0;
        
        await bot.sendMessage(chatId, `🔍 *Scanner Started (Top 200)*\nTarget: RSI 10-30 & 70-100\nScanning 200 coins...`);

        for (const tf of timeframes) {
            for (const coin of coins) {
                const signalFound = await analyzeCoin(coin, tf);
                if (signalFound) totalSignals++;
                await new Promise(res => setTimeout(res, 450));
            }
        }
        await bot.sendMessage(chatId, `✅ Scan Finished. Found ${totalSignals} alerts.`);
    } catch (error) { console.error(error.message); }
}

run();
