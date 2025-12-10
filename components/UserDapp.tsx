import React, { useState, useEffect } from 'react';
import { Wallet, ArrowRight, ShieldCheck, Zap, TrendingUp, Lock, Coins, LogOut, CheckCircle2 } from 'lucide-react';
import { SimulationStats } from '../types';

interface UserDappProps {
  stats: SimulationStats;
  onDeposit: (amount: number) => void;
  isProcessing?: boolean;
}

export const UserDapp: React.FC<UserDappProps> = ({ stats, onDeposit, isProcessing = false }) => {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [address, setAddress] = useState<string>('');
  const [amount, setAmount] = useState<string>('100');
  const [userBalance, setUserBalance] = useState<number>(5000);
  const [txHash, setTxHash] = useState<string | null>(null);

  const handleConnect = () => {
    // Simulate wallet connection delay
    setTimeout(() => {
      setIsConnected(true);
      const randomAddr = '0x' + Array(40).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('').substring(0, 8) + '...' + 'A1B2';
      setAddress(randomAddr);
    }, 500);
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setAddress('');
    setTxHash(null);
  };

  const handleDeposit = () => {
    if (!isConnected) return;
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) return;
    if (val > userBalance) return;

    setUserBalance(prev => prev - val);
    onDeposit(val);
    
    // Simulate Tx Hash
    const hash = '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    setTxHash(hash);
    setTimeout(() => setTxHash(null), 3000);
  };

  const effectiveROI = stats.multiplier * 100;
  const potentialReturn = parseFloat(amount || '0') * stats.multiplier;

  return (
    <div className="h-full flex flex-col items-center justify-center p-4 bg-[#0b0f19] text-slate-200 font-sans relative overflow-hidden rounded-3xl border border-slate-800 shadow-2xl">
      {/* Background Ambience */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none"></div>

      {/* Navbar */}
      <div className="w-full max-w-md flex items-center justify-between mb-8 z-10">
        <div className="flex items-center gap-2">
           <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Zap className="w-5 h-5 text-white fill-white" />
           </div>
           <span className="font-bold text-lg tracking-tight">x2gether</span>
        </div>
        
        {!isConnected ? (
          <button 
            onClick={handleConnect}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold rounded-xl border border-slate-700 transition-all active:scale-95 flex items-center gap-2"
          >
            <Wallet className="w-4 h-4" /> Connect Wallet
          </button>
        ) : (
          <button 
            onClick={handleDisconnect}
            className="px-4 py-2 bg-slate-900/50 hover:bg-slate-800 text-slate-300 text-sm font-mono rounded-xl border border-slate-800 transition-all flex items-center gap-2 group"
          >
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
            {address}
            <LogOut className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity ml-1" />
          </button>
        )}
      </div>

      {/* Main Card */}
      <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 shadow-2xl relative z-10">
         
         {/* Stats Row */}
         <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-950/50 p-3 rounded-2xl border border-slate-800">
               <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Current ROI</div>
               <div className="text-xl font-bold text-emerald-400 flex items-center gap-1">
                  {stats.multiplier.toFixed(2)}x <TrendingUp className="w-3 h-3" />
               </div>
            </div>
            <div className="bg-slate-950/50 p-3 rounded-2xl border border-slate-800">
               <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Protocol TVL</div>
               <div className="text-xl font-bold text-white">
                  ${(stats.protocolBalance + stats.totalDeposited).toLocaleString('en-US', {notation: 'compact'})}
               </div>
            </div>
         </div>

         {/* Input Area */}
         <div className="space-y-4 mb-6">
            <div className="relative">
               <div className="flex justify-between text-xs text-slate-400 mb-2">
                  <span className="font-bold uppercase">Amount to Deposit</span>
                  <span>Balance: {isConnected ? `$${userBalance.toLocaleString()}` : '-'}</span>
               </div>
               <div className="relative group">
                  <input 
                     type="number" 
                     value={amount}
                     onChange={(e) => setAmount(e.target.value)}
                     disabled={!isConnected}
                     className="w-full bg-slate-950 border border-slate-700 rounded-2xl p-4 text-2xl font-bold text-white placeholder-slate-700 outline-none focus:border-emerald-500/50 transition-all disabled:opacity-50"
                     placeholder="0.00"
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
                     <span className="text-sm font-bold text-slate-500">USDC</span>
                     <div className="w-6 h-6 rounded-full bg-[#2775CA] flex items-center justify-center">
                        <span className="text-[8px] font-bold text-white">$</span>
                     </div>
                  </div>
               </div>
            </div>

            <div className="bg-slate-950/30 rounded-xl p-4 border border-slate-800/50 flex justify-between items-center">
               <span className="text-xs text-slate-400">Potential Payout</span>
               <span className="text-lg font-bold text-emerald-400 flex items-center gap-1">
                  ${potentialReturn.toLocaleString(undefined, {maximumFractionDigits: 2})}
                  <Coins className="w-3.5 h-3.5 text-emerald-500/50" />
               </span>
            </div>
         </div>

         {/* Action Button */}
         <button
            onClick={handleDeposit}
            disabled={!isConnected || parseFloat(amount) <= 0 || parseFloat(amount) > userBalance}
            className={`w-full py-4 rounded-2xl font-bold text-lg transition-all transform active:scale-[0.98] shadow-lg ${
               !isConnected 
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700' 
                  : 'bg-emerald-500 hover:bg-emerald-400 text-slate-900 shadow-emerald-500/20'
            }`}
         >
            {!isConnected ? 'Connect Wallet First' : 'Deposit USDC'}
         </button>
         
         {/* Footer Info */}
         <div className="mt-6 flex items-center justify-center gap-2 text-[10px] text-slate-500">
            <ShieldCheck className="w-3 h-3" />
            <span>Audited by Virtual Architects</span>
         </div>

         {/* Success Toast Simulation */}
         {txHash && (
            <div className="absolute top-4 left-4 right-4 bg-slate-800 text-emerald-400 text-xs p-3 rounded-xl border border-emerald-500/20 shadow-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
               <CheckCircle2 className="w-4 h-4 text-emerald-500" />
               <div>
                  <div className="font-bold">Transaction Sent</div>
                  <div className="opacity-60 font-mono truncate w-48">{txHash}</div>
               </div>
            </div>
         )}
      </div>

      <div className="mt-8 text-center">
          <p className="text-xs text-slate-600 max-w-xs mx-auto leading-relaxed">
             This interface connects directly to the simulation engine. Deposits made here will appear in the queue immediately.
          </p>
      </div>
    </div>
  );
};
