import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Wordmark, AmbientVideo } from "@/shared/ui";
import { SITE_NAME, STORE_EMAIL } from "@/shared/config";
export function Footer() {
  return (
    <footer className="site-footer footer-noir" id="macbook">
      <div className="footer-background" aria-hidden="true">
        <AmbientVideo
          src="/media/macbook-noir.webm"
          poster="/media/macbook-noir-poster.jpg"
          label=""
          showControls={false}
        />
      </div>
      <div className="container">
        <div className="footer-top">
          <div>
            <Link href="/" className="logo footer-logo">
              <Wordmark />
            </Link>
            <p>
              Техника, с которой
              <br />
              каждый день — чуть лучше.
            </p>
          </div>
          <div>
            <h3>Выбирайте своё</h3>
            <Link href="/catalog?brand=Apple">
              Apple <ArrowUpRight size={13} />
            </Link>
            <Link href="/catalog?category=smartphones">
              iPhone <ArrowUpRight size={13} />
            </Link>
            <Link href="/catalog?category=laptops">
              MacBook <ArrowUpRight size={13} />
            </Link>
            <Link href="/catalog?category=accessories">
              Аксессуары <ArrowUpRight size={13} />
            </Link>
          </div>
          <div>
            <h3>Мы рядом</h3>
            <Link href="/info/delivery">Доставка и оплата</Link>
            <Link href="/info/warranty">Гарантия и возврат</Link>
            <Link href="/info/contacts">Контакты</Link>
            <Link href="/info/privacy">Обработка данных</Link>
          </div>
          <div className="footer-contact">
            <a href={`mailto:${STORE_EMAIL}`}>
              {STORE_EMAIL} <ArrowUpRight size={17} />
            </a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>
            © {new Date().getFullYear()} {SITE_NAME}
          </span>
          <span>
            Демонстрационная витрина · наличие и цены требуют подтверждения
          </span>
          <span>
            С заботой о вашем выборе <span className="tiny-heart">♡</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
