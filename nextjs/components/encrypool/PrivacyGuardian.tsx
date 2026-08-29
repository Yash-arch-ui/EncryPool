"use client";

const PrivacyGuardian = () => {
  return (
    <div className="guardian-container">
      {/* Floating particles */}
      <div className="guardian-particles">
        <span className="particle p1" />
        <span className="particle p2" />
        <span className="particle p3" />
        <span className="particle p4" />
        <span className="particle p5" />
        <span className="particle p6" />
      </div>

      {/* Glow ring */}
      <div className="guardian-ring" />

      {/* Robot SVG */}
      <svg className="guardian-svg" viewBox="0 0 300 420" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="robot-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="body-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#1a1f2e" />
            <stop offset="100%" stopColor="#0d111c" />
          </linearGradient>
          <linearGradient id="visor-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2ec4b6" />
            <stop offset="50%" stopColor="#00e5ff" />
            <stop offset="100%" stopColor="#2ec4b6" />
          </linearGradient>
        </defs>

        {/* === LEFT LEG === */}
        <g className="leg-left">
          <rect x="108" y="305" width="30" height="55" rx="8" fill="#1a1f2e" stroke="#2ec4b6" strokeWidth="1" />
          <rect x="103" y="355" width="40" height="16" rx="6" fill="#10131c" stroke="#2ec4b6" strokeWidth="1" />
          {/* Foot light */}
          <rect x="115" y="363" width="16" height="4" rx="2" fill="#2ec4b6" className="foot-glow" />
        </g>

        {/* === RIGHT LEG === */}
        <g className="leg-right">
          <rect x="162" y="305" width="30" height="55" rx="8" fill="#1a1f2e" stroke="#2ec4b6" strokeWidth="1" />
          <rect x="157" y="355" width="40" height="16" rx="6" fill="#10131c" stroke="#2ec4b6" strokeWidth="1" />
          {/* Foot light */}
          <rect x="169" y="363" width="16" height="4" rx="2" fill="#2ec4b6" className="foot-glow" />
        </g>

        {/* === BODY === */}
        <g className="robot-body">
          {/* Main torso */}
          <rect
            x="95"
            y="175"
            width="110"
            height="135"
            rx="20"
            fill="url(#body-grad)"
            stroke="#292e3b"
            strokeWidth="1.5"
          />
          {/* Chest plate */}
          <rect x="115" y="195" width="70" height="50" rx="12" fill="#0d111c" stroke="#2ec4b6" strokeWidth="1" />
          {/* Heart core */}
          <circle cx="150" cy="220" r="14" fill="#ff6b4a" className="heart-core" />
          <circle cx="150" cy="220" r="8" fill="#ff8a6a" className="heart-pulse" />
          {/* Chest lines */}
          <line
            x1="120"
            y1="260"
            x2="180"
            y2="260"
            stroke="#2ec4b6"
            strokeWidth="0.8"
            strokeDasharray="4 3"
            className="chest-line"
          />
          <line
            x1="125"
            y1="270"
            x2="175"
            y2="270"
            stroke="#2ec4b6"
            strokeWidth="0.8"
            strokeDasharray="4 3"
            className="chest-line"
          />
          <line
            x1="130"
            y1="280"
            x2="170"
            y2="280"
            stroke="#2ec4b6"
            strokeWidth="0.8"
            strokeDasharray="4 3"
            className="chest-line"
          />
          {/* Belly indicator */}
          <circle cx="150" cy="295" r="5" fill="#2ec4b6" filter="url(#robot-glow)" className="belly-light" />
        </g>

        {/* === LEFT ARM === */}
        <g className="arm-left">
          <rect x="65" y="185" width="28" height="70" rx="10" fill="#1a1f2e" stroke="#292e3b" strokeWidth="1.2" />
          <circle cx="79" cy="260" r="10" fill="#10131c" stroke="#2ec4b6" strokeWidth="1" />
          {/* Hand */}
          <circle cx="79" cy="275" r="7" fill="#1a1f2e" stroke="#2ec4b6" strokeWidth="0.8" />
        </g>

        {/* === RIGHT ARM === */}
        <g className="arm-right">
          <rect x="207" y="185" width="28" height="70" rx="10" fill="#1a1f2e" stroke="#292e3b" strokeWidth="1.2" />
          <circle cx="221" cy="260" r="10" fill="#10131c" stroke="#2ec4b6" strokeWidth="1" />
          {/* Hand */}
          <circle cx="221" cy="275" r="7" fill="#1a1f2e" stroke="#2ec4b6" strokeWidth="0.8" />
        </g>

        {/* === NECK === */}
        <rect x="135" y="155" width="30" height="25" rx="4" fill="#10131c" stroke="#292e3b" strokeWidth="1" />

        {/* === HEAD === */}
        <g className="robot-head">
          {/* Head base */}
          <rect
            x="100"
            y="80"
            width="100"
            height="80"
            rx="22"
            fill="url(#body-grad)"
            stroke="#292e3b"
            strokeWidth="1.5"
          />
          {/* Antenna */}
          <line x1="150" y1="80" x2="150" y2="55" stroke="#292e3b" strokeWidth="2" />
          <circle cx="150" cy="50" r="6" fill="#2ec4b6" filter="url(#robot-glow)" className="antenna-light" />
          {/* Ear left */}
          <rect x="88" y="105" width="14" height="22" rx="5" fill="#10131c" stroke="#292e3b" strokeWidth="1" />
          <rect x="91" y="111" width="8" height="10" rx="3" fill="#2ec4b6" opacity="0.4" className="ear-glow" />
          {/* Ear right */}
          <rect x="198" y="105" width="14" height="22" rx="5" fill="#10131c" stroke="#292e3b" strokeWidth="1" />
          <rect x="201" y="111" width="8" height="10" rx="3" fill="#2ec4b6" opacity="0.4" className="ear-glow" />
          {/* Visor / Eyes */}
          <rect x="115" y="100" width="70" height="28" rx="10" fill="#0d111c" stroke="#2ec4b6" strokeWidth="1.2" />
          {/* Left eye */}
          <circle cx="135" cy="114" r="8" fill="url(#visor-grad)" className="eye-left" />
          <circle cx="135" cy="114" r="4" fill="#fff" opacity="0.9" />
          {/* Right eye */}
          <circle cx="165" cy="114" r="8" fill="url(#visor-grad)" className="eye-right" />
          <circle cx="165" cy="114" r="4" fill="#fff" opacity="0.9" />
          {/* Mouth */}
          <rect x="130" y="132" width="40" height="6" rx="3" fill="#2ec4b6" opacity="0.3" className="mouth-line" />
        </g>
      </svg>
    </div>
  );
};

export default PrivacyGuardian;
