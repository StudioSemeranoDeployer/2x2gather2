
import React, { useState } from 'react';
import { Copy, Check, FileText } from 'lucide-react';

export const SmartContractViewer: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const solidityCode = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol"; // For Random Decay

contract X2GetherProtocol is Ownable {
    
    struct Player {
        address wallet;
        uint256 deposit;    
        uint256 collected;  
        uint256 target;     
        uint256 timestamp;
        uint256 multiplier;
        bool slashed;
        bool isTaxTarget;
    }

    IERC20 public usdcToken;
    Player[] public queue;
    uint256 public protocolVault; // Starts with Configured Initial Reserve
    uint256 public jackpotBalance;
    uint256 public totalUsers;
    uint256 public constant MAX_DAYS = 30; // Auto-pause trigger
    uint256 public deploymentTime;
    
    // Config
    uint256 public constant BASE_MULTIPLIER = 200; // 2.0x
    uint256 public INITIAL_RESERVE = 30000 * 10**6;
    
    // Configurable Strategy Parameters
    uint256 public WINNERS_TAX_FREQUENCY = 10; 
    uint256 public WINNERS_TAX_RATE = 20; // 20%
    
    uint256 public GUILLOTINE_INTERVAL = 60; // Ticks
    uint256 public GUILLOTINE_STRENGTH = 20; // 20%
    uint256 public GUILLOTINE_THRESHOLD = 900 * 10**6; 
    
    uint256 public JACKPOT_FREQUENCY = 1000;
    uint256 public JACKPOT_AMOUNT = 1000 * 10**6;

    bool public dynamicDecayEnabled;
    bool public randomDecayEnabled; // New Feature
    bool public winnersTaxEnabled;
    bool public taxBotEnabled;
    uint256 public taxBotFrequency; // e.g. 100
    
    // Random Decay
    uint256 public randomDecayMin = 120; // 1.2x
    uint256 public randomDecayMax = 250; // 2.5x
    uint256 public currentRandomMultiplier = 200; 

    event Deposit(address indexed user, uint256 amount, uint256 target);
    event DailyDrip(uint256 amount);
    event RandomMultiplierChange(uint256 newMult);

    constructor(address _usdcAddress) Ownable(msg.sender) {
        usdcToken = IERC20(_usdcAddress);
        protocolVault = INITIAL_RESERVE;
        deploymentTime = block.timestamp;
    }

    function deposit(uint256 amount) external {
        require(block.timestamp < deploymentTime + 30 days, "Protocol Paused");
        
        // ... Transfer and Fee logic ...
        totalUsers++;
        uint256 mult = BASE_MULTIPLIER;
        
        // 1. Random Decay Logic
        if (randomDecayEnabled) {
             // Logic: Every X users, call Chainlink VRF or use block.prevrandao
             // to set new currentRandomMultiplier between MIN and MAX
             mult = currentRandomMultiplier;
        } 
        // 2. Dynamic Decay Logic (Min/Max Clamped)
        else if (dynamicDecayEnabled) {
             // Logic to reduce mult based on queue length
        }

        uint256 target = (amount * mult) / 100;
        
        // ... Winners Tax Logic ...

        queue.push(Player({
            wallet: msg.sender,
            deposit: amount,
            collected: 0,
            target: target,
            timestamp: block.timestamp,
            multiplier: mult,
            slashed: false,
            isTaxTarget: false // ...
        }));
        
        // ... Bot Checks (Jackpot, Tax) ...
        // ... Drip Checks ...
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
            <span className="text-xs text-slate-400">Base Mainnet • v5.0 (Random + Configurable)</span>
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
