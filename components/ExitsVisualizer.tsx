
import React from 'react';
import { Player } from '../types';
import { LogOut, ArrowRight, Zap, Skull, Shield } from 'lucide-react';

interface ExitsVisualizerProps {
  exits: Player[];
}

export const ExitsVisualizer: React.FC<ExitsVisualizerProps> = ({ exits }) => {
  if (exits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full border-2 border-dashed border-slate-800 rounded-xl text-slate-600">
        <div className="bg-slate-900 p-3 rounded-full mb-2">
          <LogOut className="w-6 h-6 opacity-20" />
        </div>
        <p className="text-xs font-medium">No exits yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 h-full overflow-y-auto pr-2 custom-scrollbar">
      {exits.map((player) => {
        const isProfit = (player.netProfit || 0) > 0;
        const isFast = player.fastFilled;
        const isSlashed = player.slashed;
        
        return (
          <div 
            key={player.id}
            className={`p-3 rounded-lg border flex items-center justify-between transition-all ${
              isSlashed ? 'bg-red-950/30 border-red-900/50' :
              isProfit ? 'bg-slate-900 border-slate-800' : 
              'bg-slate-900 border-slate-800 opacity-60'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                 isSlashed ? 'bg-red-500/20 text-red-500' :
                 isFast ? 'bg-yellow-500/10 text-yellow-500' :
                 'bg-slate-800 text-slate-400'
              }`}>
                 {isSlashed ? <Skull className="w-4 h-4" /> : 
                  isFast ? <Zap className="w-4 h-4" /> : 
                  <ArrowRight className="w-4 h-4" />}
              </div>
              <div>
                <div className="text-[10px] text-slate-500 font-mono uppercase">
                  {player.id.startsWith('PROTOCOL') ? 'PROTOCOL' : player.id.startsWith('JACKPOT') ? 'JACKPOT' : `User ${player.id.slice(0,4)}`}
                </div>
                <div className="text-xs font-bold text-slate-300">
                   ${player.deposit.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="text-right">
              <div className="text-[9px] text-slate-500 uppercase mb-0.5">Net Result</div>
              <div className={`font-mono font-bold text-xs ${isProfit ? 'text-emerald-400' : 'text-slate-400'}`}>
                {isProfit ? '+' : ''}${(player.netProfit || 0).toFixed(0)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
