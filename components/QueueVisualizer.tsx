
import React from 'react';
import { Player } from '../types';
import { User, Lock, Wallet, Skull, Bot, Trophy, Zap, Ghost, ShieldAlert } from 'lucide-react';

interface QueueVisualizerProps {
  queue: Player[];
  maxDisplay?: number;
}

export const QueueVisualizer: React.FC<QueueVisualizerProps> = ({ queue, maxDisplay = 6 }) => {
  const displayQueue = queue.slice(0, maxDisplay);
  
  if (queue.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full border-2 border-dashed border-slate-800 rounded-xl text-slate-600">
        <div className="bg-slate-900 p-4 rounded-full mb-3">
          <User className="w-8 h-8 opacity-20" />
        </div>
        <p className="text-sm font-medium">Queue is empty</p>
        <p className="text-xs opacity-60">Waiting for depositors...</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 h-full overflow-y-auto pr-2 custom-scrollbar">
      {displayQueue.map((player, index) => {
        const progress = (player.collected / player.target) * 100;
        const isFirst = index === 0;
        const isJackpotBot = player.id.startsWith('JACKPOT_BOT');
        const isTaxBot = player.id.startsWith('TAX_BOT');
        const isProtocol = player.id === 'PROTOCOL_SEED';
        const isUnlucky = player.isUnlucky;

        return (
          <div 
            key={player.id}
            className={`relative overflow-hidden rounded-xl border transition-all duration-300 ${
              player.slashed ? 'border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]' :
              isUnlucky ? 'border-slate-500/50 grayscale' :
              isJackpotBot ? 'border-amber-500/50 bg-amber-950/20' :
              isTaxBot ? 'border-purple-500/50 bg-purple-950/20' :
              isFirst 
                ? 'bg-slate-800/80 border-emerald-500/50 shadow-[0_4px_20px_-5px_rgba(16,185,129,0.3)]' 
                : 'bg-slate-900 border-slate-800 opacity-90'
            }`}
          >
            {/* Background Progress Bar */}
            <div 
              className={`absolute top-0 left-0 h-full transition-all duration-300 opacity-20 ${
                player.slashed ? 'bg-red-900' : 
                isUnlucky ? 'bg-slate-500' :
                isJackpotBot ? 'bg-amber-500' : 
                isTaxBot ? 'bg-purple-500' :
                isFirst ? 'bg-emerald-500' : 'bg-slate-600'
              }`}
              style={{ width: `${Math.min(100, progress)}%` }}
            />

            <div className="relative p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shadow-sm ${
                  player.slashed ? 'bg-red-500/20 text-red-500 border border-red-500/30' :
                  isUnlucky ? 'bg-slate-700 text-slate-400 border border-slate-600' :
                  isJackpotBot ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30' :
                  isTaxBot ? 'bg-purple-500/20 text-purple-500 border border-purple-500/30' :
                  isFirst ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}>
                  {player.slashed ? <Skull className="w-4 h-4" /> : 
                   isUnlucky ? <ShieldAlert className="w-4 h-4" /> :
                   isJackpotBot ? <Trophy className="w-4 h-4" /> : 
                   isTaxBot ? <Ghost className="w-4 h-4" /> :
                   index + 1}
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider flex items-center gap-1">
                     {isProtocol ? 'PROTOCOL' : isJackpotBot ? 'JACKPOT BOT' : isTaxBot ? 'TAX BOT' : `ID: ${player.id.slice(0, 6)}...`}
                  </div>
                  <div className="text-sm font-semibold text-slate-200 flex items-center gap-1">
                    <Wallet className="w-3 h-3 text-slate-500" /> ${player.deposit.toLocaleString()}
                    {player.multiplier && (
                       <span className={`ml-1 text-[10px] px-1 rounded border flex items-center ${isUnlucky ? 'bg-slate-700 text-slate-300 border-slate-600' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                         {player.multiplier.toFixed(2)}x
                       </span>
                    )}
                    {player.fastFilled && !isTaxBot && !isJackpotBot && !isProtocol && (
                        <span className="ml-1 text-yellow-400 animate-pulse" title="Fast Filled (Turn < 10)">
                           <Zap className="w-3 h-3 fill-yellow-400" />
                        </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="text-right">
                 <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">{isUnlucky ? 'Refund Only' : 'Payout'}</div>
                 <div className={`font-mono font-bold text-sm ${player.slashed ? 'text-red-400' : isUnlucky ? 'text-slate-300' : isJackpotBot ? 'text-amber-400' : isTaxBot ? 'text-purple-400' : isFirst ? 'text-emerald-400' : 'text-slate-400'}`}>
                   ${player.collected.toFixed(0)} <span className={`text-xs ${player.slashed ? 'text-red-600 line-through' : 'text-slate-600'}`}>/ ${player.target.toFixed(0)}</span>
                 </div>
              </div>
            </div>
          </div>
        );
      })}

      <div className="text-center py-4">
         <p className="text-xs text-slate-500 italic flex items-center justify-center gap-2">
            <Lock className="w-3 h-3" />
            <span>Funds are locked in Smart Contract</span>
         </p>
      </div>
    </div>
  );
};
