import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, AudioLines } from "lucide-react";
import { HeroAurora, Fade } from "@/shared/ui";
export function Hero() {
  return (
    <section className="hero-layout" aria-label="Техника для каждого дня">
      <div className="hero-main">
        <HeroAurora />
        <div className="hero-copy">
          <div className="hero-eyebrow">
            <span /> Ближе к тому, что любишь
          </div>
          <h1>
            Большие идеи.
            <br />В ваших руках.
          </h1>
          <p>
            Ваш следующий iPhone уже здесь.
            <br />
            Выберите цвет. Найдите свой.
          </p>
          <Link
            className="button button-dark"
            href="/catalog?category=smartphones&brand=Apple"
          >
            Выбрать iPhone <ArrowRight size={18} />
          </Link>
          <div className="hero-pagination" aria-label="Коллекция iPhone">
            <span className="active" />
            <span />
            <span />
          </div>
        </div>
        <Fade className="hero-product">
          <span className="hero-product-type">iPhone 16</span>
          <Image
            src="/images/iphone-hq.png"
            alt="Apple iPhone 16, ультрамарин"
            fill
            sizes="(max-width: 700px) 180vw, 120vw"
            loading="eager"
            fetchPriority="high"
          />
          <div className="hero-sticker">
            <span className="sticker-dot" />
            <span>
              Цвет, который
              <br />
              <strong>говорит за вас.</strong>
            </span>
            <ArrowUpRight size={17} />
          </div>
        </Fade>
        <div className="hero-fineprint">
          Apple iPhone 16 <span>·</span> Найдите свою конфигурацию
        </div>
      </div>
      <Link href="/catalog?category=headphones" className="hero-side">
        <div className="hero-side-top">
          <span className="eyebrow">
            Меньше шума.
            <br />
            Больше музыки.
          </span>
          <span className="round-arrow">
            <ArrowUpRight size={22} />
          </span>
        </div>
        <h2>
          Только вы.
          <br />И ваш плейлист.
        </h2>
        <div className="side-product">
          <Image
            src="/images/airpods-pro.png"
            alt="AirPods Pro 2"
            fill
            sizes="(max-width: 700px) 60vw, 28vw"
          />
        </div>
        <div className="side-bottom">
          <span>
            <strong>AirPods Pro 2</strong>
            <small>Маленькие. Впечатляющие.</small>
          </span>
          <AudioLines size={29} strokeWidth={1.2} />
        </div>
      </Link>
    </section>
  );
}
