
import React, { useState } from 'react';
import { Copy, Check, FileText } from 'lucide-react';

export const SmartContractViewer: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const solidityCode = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol"; 

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
    
    // Elastic Strategy
    bool public elasticMode;
    uint256 public elasticMin = 120; // 1.2x
    uint256 public elasticMax = 250; // 2.5x
    uint256 public currentElasticMult = 200;

    // Chaos Mode
    bool public chaosMode;
    
    // Dynamic Success Tax
    bool public dynamicSuccessTax; // (Mult - 1.0) * 10%
    
    // Risk: 10% Break Even
    bool public randomUnluckyEnabled;

    event Deposit(address indexed user, uint256 amount, uint256 multiplier);
    event Payout(address indexed user, uint256 amount, uint256 taxPaid);

    constructor(address _usdcAddress) Ownable(msg.sender) {
        usdcToken = IERC20(_usdcAddress);
    }

    function deposit(uint256 amount) external {
        uint256 mult = 200; // Base 2.0x
        bool isUnlucky = false;

        // 1. RISK CHECK: 10% Break-Even
        if (randomUnluckyEnabled) {
            // Pseudo-random check (use VRF in production)
            if ((uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender))) % 100) < 10) {
                mult = 100; // Force 1.0x
                isUnlucky = true;
            }
        }

        // 2. If not unlucky, calculate strategy multiplier
        if (!isUnlucky) {
            if (chaosMode) {
                 // Randomly flip between Elastic and Random Logic
                 if (block.prevrandao % 2 == 0) {
                     mult = _getElasticMult();
                 } else {
                     mult = _getRandomMult(elasticMin, elasticMax);
                 }
            } else if (elasticMode) {
                 mult = _getElasticMult();
            }
        }

        uint256 target = (amount * mult) / 100;
        queue.push(Player(msg.sender, amount, 0, target, mult, true, isUnlucky));
        
        emit Deposit(msg.sender, amount, mult);
    }

    function _getElasticMult() internal returns (uint256) {
        uint256 qLen = queue.length; // Simplified active count
        // Breathing Logic
        if (qLen < 20) {
            if (currentElasticMult < elasticMax) currentElasticMult += 5;
        } else if (qLen > 50) {
            if (currentElasticMult > elasticMin) currentElasticMult -= 5;
        }
        return currentElasticMult;
    }

    function _processPayout(uint256 playerIndex, uint256 amount) internal {
        Player storage p = queue[playerIndex];
        // ... payout logic ...
        
        // Dynamic Success Fee Calculation on Exit
        // NOTE: Unlucky users (1.0x) pay 0 tax because (1.0 - 1.0) = 0
        if (p.collected >= p.target && dynamicSuccessTax) {
             uint256 profit = p.target - p.deposit;
             
             if (profit > 0) {
                 // Rate = (Multiplier - 1.0) * 0.10
                 // e.g. 2.0x -> 10%, 1.5x -> 5%
                 uint256 taxRate = (p.multiplier - 100) * 10; // Scaled
                 uint256 tax = (profit * taxRate) / 10000;
                 
                 // Transfer Net to user, Tax to Vault
                 emit Payout(p.wallet, p.target - tax, tax);
             } else {
                 emit Payout(p.wallet, p.target, 0);
             }
        }
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
            <span className="text-xs text-slate-400">Base Mainnet • v6.0 (Elastic + Chaos)</span>
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
