import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './components/App';
import { ErrorBoundary } from './components/ErrorBoundary';
import '@mui/material/styles';
import '@mui/material/CssBaseline';
import './index.css';

async function initializeApp() {
  try {
    // Check if service worker is ready by attempting to connect
    const port = chrome.runtime.connect({ name: 'popup' });
    
    // Wait for service worker to respond
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Service worker connection timeout'));
      }, 5000);

      port.onMessage.addListener((message) => {
        clearTimeout(timeout);
        if (message.type === 'PONG') {
          resolve();
        } else if (message.type === 'NOT_READY') {
          reject(new Error(message.error || 'Service worker not ready'));
        } else {
          reject(new Error('Unexpected response from service worker'));
        }
      });

      port.onDisconnect.addListener(() => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          console.error('Service worker connection failed:', chrome.runtime.lastError);
          reject(new Error('Failed to connect to service worker'));
        }
      });
      
      // Send ping to verify connection
      port.postMessage({ type: 'PING' });
    });

    try {
      // Create root element
      const container = document.getElementById('root');
      if (!container) {
        throw new Error('Root element not found');
      }

      // Create React root and render app
      const root = createRoot(container);
      root.render(
        <React.StrictMode>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </React.StrictMode>
      );
    } catch (error) {
      console.error('Failed to render app:', error);
      throw error; // Re-throw to show error UI
    }
  } catch (error) {
    console.error('Failed to initialize popup:', error);
    document.body.innerHTML = `
      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100vh;
        text-align: center;
        padding: 20px;
        color: #d32f2f;
        font-family: system-ui;
      ">
        <h2 style="margin: 0 0 10px 0; font-size: 16px;">Failed to Initialize</h2>
        <p style="margin: 0; font-size: 14px; color: #666;">
          ${error instanceof Error ? error.message : 'An unexpected error occurred'}
        </p>
        <button onclick="window.location.reload()" style="
          margin-top: 15px;
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          background: #1a73e8;
          color: white;
          font-size: 14px;
          cursor: pointer;
        ">
          Retry
        </button>
      </div>
    `;
  }
}

initializeApp();
