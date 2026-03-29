import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';

function Popup() {
  const [tabCount, setTabCount] = useState(0);

  useEffect(() => {
    chrome.tabs.query({}).then((tabs) => setTabCount(tabs.length));
  }, []);

  const openSidePanel = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      window.close();
    }
  };

  return (
    <div className="w-52 p-3 space-y-3">
      <h1 className="text-sm font-semibold text-gray-800">AI Tab Optimizer</h1>
      <div className="text-2xl font-bold text-accent text-center py-2">
        {tabCount}
        <div className="text-xs font-normal text-gray-500">open tabs</div>
      </div>
      <button
        onClick={openSidePanel}
        className="w-full px-3 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded"
      >
        Open Side Panel
      </button>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
);
