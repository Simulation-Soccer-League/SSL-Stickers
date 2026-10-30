import type { AppProps } from "next/app";
import Head from "next/head";
import Link from "next/link";
import { AppCacheProvider } from "@mui/material-nextjs/v16-pagesRouter";
import Menu from "../components/Menu.tsx";
import TradingMenu from "../components/TradingMenu.tsx";
import MyCardsMenu from "../components/MyCardsMenu.tsx";
import PageWrapper from "../components/PageWrapper.tsx";
import { ContextProvider } from "../utils/ContextProvider.tsx";

import "../styles/index.css";
import "../styles/App.css";

export default function App(props: AppProps) {
  const { Component, pageProps } = props;

  return (
    <AppCacheProvider {...props}>
      <Head>
        <title>SSL-Sticker-Store</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>
      <ContextProvider>
        <div className="app-shell">
          <header className="site-header">
            <div className="header-right">
              <Link href="/" className="site-title">
                SSL Sticker Store
              </Link>
              <nav className="header-navigation" aria-label="Main navigation">
                <MyCardsMenu />
                <TradingMenu />
              </nav>
            </div>
            <Menu />
          </header>
          <PageWrapper>
            <Component {...pageProps} />
          </PageWrapper>
        </div>
      </ContextProvider>
    </AppCacheProvider>
  );
}
