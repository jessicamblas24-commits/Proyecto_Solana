import { Buffer } from "buffer";
(window as any).Buffer = Buffer; // requerido por @solana/web3.js en navegador

import React from "react";
import { createRoot } from "react-dom/client";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import App from "./App";
import "./styles.css";

export const RPC: string = import.meta.env.VITE_RPC ?? "https://api.devnet.solana.com";

// wallets = [] → se usan las wallets detectadas por Wallet Standard (Phantom, Solflare, Backpack…).
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConnectionProvider endpoint={RPC}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </React.StrictMode>
);
