
import React, { useState } from 'react';
import { Copy, Check, FileText } from 'lucide-react';

export const SmartContractViewer: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const solidityCode = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract X2GetherProtocol is Ownable {
    
    struct Player {
        address wallet;
        uint256 deposit;    
        uint256 collected;  
        uint256 target;     
        uint256 multiplier;
        bool isClient;
        bool isUnlucky;
    }

    IERC20 public usdcToken;
    Player[] public queue;
    
    // Core Config
    uint256 public entryFeePercent = 50; // 5.0%
    uint256 public constant MAX_DEPOSIT = 1000 * 10**6; 
    uint256 public constant MAX_TX_PER_ROUND = 1000;
    uint256 public txCount;

    // Round Logic
    uint256 public roundExpiry;
    address public lastDepositor;
    uint256 public jackpotPool;
    bool public roundActive;

    // Emergency Exit Config
    uint256 public constant EXIT_PENALTY = 20; // 20%

    event Deposit(address indexed user, uint256 amount, uint256 multiplier);
    event EmergencyExit(address indexed user, uint256 refundAmount);
    event RoundEnded(address winner, uint256 jackpot);

    constructor(address _usdcAddress) Ownable(msg.sender) {
        usdcToken = IERC20(_usdcAddress);
        roundExpiry = block.timestamp + 24 hours;
        roundActive = true;
    }

    function deposit(uint256 amount) external {
        require(roundActive, "Round ended");
        require(txCount < MAX_TX_PER_ROUND, "Tx limit reached");
        require(amount <= MAX_DEPOSIT, "Max deposit 1000 USDC");
        require(block.timestamp < roundExpiry, "Time expired");

        // ROUND LOGIC
        txCount++;
        if (txCount >= MAX_TX_PER_ROUND) {
             _triggerRoundEnd();
             return;
        }

        // EXTEND TIMER
        roundExpiry += 10 minutes;
        if(roundExpiry > block.timestamp + 24 hours) {
            roundExpiry = block.timestamp + 24 hours;
        }
        lastDepositor = msg.sender;

        // ... Multiplier Logic ...
        uint256 mult = 200; 
        
        uint256 totalFee = (amount * entryFeePercent) / 1000;
        jackpotPool += totalFee / 2;
        
        uint256 netAmount = amount - totalFee;
        uint256 target = (amount * mult) / 100;
        
        queue.push(Player(msg.sender, amount, 0, target, mult, true, false));
        _distribute(netAmount);
    }

    function emergencyExit(uint256 index) external {
        Player storage p = queue[index];
        require(p.wallet == msg.sender, "Not owner");
        require(p.collected < p.deposit, "Already profitable");

        // 20% Penalty stays in contract to pay others
        uint256 penalty = (p.deposit * EXIT_PENALTY) / 100;
        uint256 refund = p.deposit - penalty;

        usdcToken.transfer(msg.sender, refund);
        
        // Remove from queue logic (swap and pop or shift)
        delete queue[index]; 
        emit EmergencyExit(msg.sender, refund);
    }
    
    function _triggerRoundEnd() internal {
        roundActive = false;
        // Pay Jackpot
        uint256 prize = jackpotPool / 2;
        usdcToken.transfer(lastDepositor, prize);
        
        // Midnight Refund Logic
        // ... Distribute remaining balance ...
    }
}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(solidityCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
      <div className="flex justify-between items-center px-6 py-4 bg-slate-950/50 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="bg-blue-500/10 p-2 rounded-lg">
             <FileText className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wide">Solidity Contract</h2>
            <span className="text-xs text-slate-400">Base Mainnet • v9.5 (Sustainable)</span>
          </div>
        </div>
        <button 
          onClick={handleCopy}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium text-white transition-colors border border-slate-700"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy Code'}
        </button>
      </div>
      <div className="relative">
        <pre className="p-6 text-xs md:text-sm font-mono text-slate-300 overflow-x-auto bg-[#0b0f19] min-h-[500px] leading-relaxed">
          <code>{solidityCode}</code>
        </pre>
      </div>
    </div>
  );
};
