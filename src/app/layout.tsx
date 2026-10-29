import type { Metadata } from "next";
import { Providers } from "./providers";
import { Header } from "@/widgets/header";
import { Footer } from "@/widgets/footer";
import { CartDrawer } from "@/widgets/cart-drawer";
import { THEME_SCRIPT } from "@/shared/config";
import { SITE_NAME } from "@/shared/config";
import "./styles/globals.css";
export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} — техника Apple для вашей жизни`,
    template: `%s · ${SITE_NAME}`,
  },
  description:
    "Техника Apple и оригинальные аксессуары. Выберите любимую модель и оставьте заявку на заказ.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Перейти к содержимому
        </a>
        <Providers>
          <Header />
          <main id="main">{children}</main>
          <Footer />
          <CartDrawer />
        </Providers>
      </body>
    </html>
  );
}
