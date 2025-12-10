
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
        bool isReinvest;
    }

    IERC20 public usdcToken;
    Player[] public queue;
    
    // Target 100 Adaptive Strategy
    bool public target100Enabled = true;
    uint256 public currentAdaptiveMult = 200; // 2.0x
    uint256 public constant MIN_MULT = 120;   // 1.2x
    uint256 public constant MAX_MULT = 200;   // 2.0x

    // Break Even Risk
    uint256 public breakEvenProbability; // e.g. 50 = 50%

    event Deposit(address indexed user, uint256 amount, uint256 multiplier);
    event Payout(address indexed user, uint256 amount);

    constructor(address _usdcAddress) Ownable(msg.sender) {
        usdcToken = IERC20(_usdcAddress);
    }

    function deposit(uint256 amount) external {
        uint256 mult = 200; // Base
        bool isUnlucky = false;

        // 1. RISK CHECK: Break-Even Slider
        // Pseudo-random (Use Chainlink VRF in prod)
        if ((uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender))) % 100) < breakEvenProbability) {
            mult = 100; // Force 1.0x
            isUnlucky = true;
        }

        // 2. If not unlucky, calculate adaptive multiplier
        if (!isUnlucky && target100Enabled) {
            mult = _getAdaptiveMult();
        }

        uint256 target = (amount * mult) / 100;
        queue.push(Player(msg.sender, amount, 0, target, mult, true, isUnlucky, false));
        
        emit Deposit(msg.sender, amount, mult);
    }

    function _getAdaptiveMult() internal returns (uint256) {
        uint256 qLen = queue.length; // Active count
        
        // Target 100 Logic
        if (qLen < 100) {
            // Drift Up to attract users
            if (currentAdaptiveMult < MAX_MULT) currentAdaptiveMult += 1;
        } else if (qLen > 100) {
            // Drift Down to clear debt
            if (currentAdaptiveMult > MIN_MULT) currentAdaptiveMult -= 1;
        }
        return currentAdaptiveMult;
    }

    function setBreakEvenProbability(uint256 _percent) external onlyOwner {
        require(_percent <= 50, "Max 50%");
        breakEvenProbability = _percent;
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
            <span className="text-xs text-slate-400">Base Mainnet • v7.0 (Target 100)</span>
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
