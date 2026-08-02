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

// 15m removed as requested
const timeframes = ['2h', '4h', '1d', '1w'];

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
        return filteredSymbols.slice(0, 200); 
    } catch (e) { return []; }
}

async function analyzeCoin(symbol, timeframe) {
    try {
        const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, 100);
        if (candles.length < 60) return false;

        const closePrices = candles.map(c => c[4]);
        
        // 1. Current closed candle (T-1)
        const currentClose = closePrices[closePrices.length - 2];
        // 2. Previous closed candle (T-2)
        const previousClose = closePrices[closePrices.length - 3];

        const ema20Arr = EMA.calculate({ period: 20, values: closePrices });
        const rsiArr = RSI.calculate({ period: 14, values: closePrices });

        const currentEma20 = ema20Arr[ema20Arr.length - 2];
        const previousEma20 = ema20Arr[ema20Arr.length - 3];
        const currentRsi = rsiArr[rsiArr.length - 2];

        if (!currentEma20 || !currentRsi) return false;

        let signals = [];
        let side = "";
        let emoji = "";

        // --- RSI RULE (Independent & Always Alert if in range) ---
        if (currentRsi >= 10 && currentRsi <= 30) {
            side = "NEW RSI LONG Opportunity"; emoji = "🟢";
            signals.push("RSI entered 10-30 (Deep Oversold)");
        } else if (currentRsi >= 70 && currentRsi <= 100) {
            side = "NEW RSI SHORT Opportunity"; emoji = "🔴";
            signals.push("RSI entered 70-100 (Extreme Overbought)");
        }

        // --- NEW EMA CROSSOVER RULE (Triggers ONLY on the exact crossing candle) ---
        
        // LONG CROSS: Previous candle was BELOW EMA, and NOW it closed ABOVE
        if (previousClose < previousEma20 && currentClose > currentEma20) {
            side = "NEW LONG Signal (EMA Cross)";
            emoji = "🟢";
            signals.push("Price just Crossed ABOVE EMA 20 (Crossover)");
        }
        
        // SHORT CROSS: Previous candle was ABOVE EMA, and NOW it closed BELOW
        else if (previousClose > previousEma20 && currentClose < currentEma20) {
            side = "NEW SHORT Signal (EMA Cross)";
            emoji = "🔴";
            signals.push("Price just Crossed BELOW EMA 20 (Crossover)");
        }

        if (signals.length > 0) {
            const baseAsset = symbol.split('/')[0]; 
            const binanceChartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${baseAsset}USDT.P`;
            
            const message = `
${emoji} *${side}*
--------------------------
⚡ *Condition:* NEW SIGNAL ONLY
🔔 *Trigger:*
${signals.map(s => "✅ " + s).join("\n")}
--------------------------
🪙 *Coin:* #${baseAsset}
⏰ *TF:* ${timeframe}
💰 *Price:* ${currentClose}
📊 *RSI:* ${currentRsi.toFixed(2)}
📉 *EMA 20:* ${currentEma20.toFixed(4)}
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
        
        for (const tf of timeframes) {
            for (const coin of coins) {
                const signalFound = await analyzeCoin(coin, tf);
                if (signalFound) totalSignals++;
                await new Promise(res => setTimeout(res, 450));
            }
        }
        await bot.sendMessage(chatId, `✅ Scan Finished. Found ${totalSignals} NEW signals.`);
    } catch (error) { console.error(error.message); }
}

run();
