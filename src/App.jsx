import { useState } from "react";
import ChordDetector from "./components/ChordDetector";
import ChordBuilder from "./components/ChordBuilder/ChordBuilder";

function App() {
  const [tab, setTab] = useState("builder");

  return (
    <div style={{ minHeight: "100%", background: "#121212" }}>
      <nav
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 8,
          padding: "16px 12px 0",
        }}
      >
        <button
          type="button"
          onClick={() => setTab("builder")}
          style={tabStyle(tab === "builder")}
        >
          Susun Manual
        </button>
        <button
          type="button"
          onClick={() => setTab("detector")}
          style={tabStyle(tab === "detector")}
        >
          AI Detector
        </button>
      </nav>

      {tab === "builder" ? <ChordBuilder /> : <ChordDetector />}
    </div>
  );
}

function tabStyle(active) {
  return {
    fontFamily: "Poppins, sans-serif",
    fontSize: 12,
    fontWeight: 500,
    padding: "10px 16px",
    borderRadius: 15,
    border: active ? "1px solid #0091ff" : "1px solid rgba(255,255,255,0.15)",
    background: active ? "#0091ff" : "transparent",
    color: "#ffffff",
    cursor: "pointer",
  };
}

export default App;
