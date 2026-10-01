import type { RenderOptions } from './types';
import { T } from './i18n';

// Auto caption + hashtags for Instagram / Facebook / WhatsApp, in the video's language
// (Hinglish / हिंदी / English). Admin can edit it afterwards.
const tag = (s: string) => '#' + s.replace(/[^\p{L}\p{M}\p{N}]/gu, '');

const BASE_TAGS = ['#4astore', '#Nabinagar', '#Aurangabad', '#Bihar', '#GroceryDelivery', '#OnlineGrocery', '#HomeDelivery'];

export function generateCaption(o: RenderOptions): string {
  const s = o.store;
  const L = T(o.lang);
  const lines: string[] = [];
  const inr = (n: number) => '₹' + n.toLocaleString('en-IN');

  if (o.template === 'festival') {
    const e = o.emojis.slice(0, 3).join('');
    lines.push(`${e} ${o.greeting || L.happy(o.festivalName)} ${e}`.trim());
    lines.push(L.cap.festivalWish(s.name, o.festivalName));
    if (o.subText) lines.push(o.subText);
  } else if (o.template === 'daily') {
    lines.push(L.cap.dailyHead(o.greeting || L.dailyTitle, s.name));
    if (o.featuredProducts.length) {
      lines.push('');
      for (const p of o.featuredProducts.slice(0, 4)) {
        lines.push(L.cap.dailyItem(`${p.name}${p.weight ? ' ' + p.weight : ''}`, inr(p.price), p.mrp > p.price ? inr(p.mrp) : null));
      }
    }
  } else {
    lines.push(L.cap.generalHead(s.name, s.tagline));
    lines.push(L.cap.generalBody);
  }

  if (o.offerText) lines.push('', `🎁 ${o.offerText}`);
  if (o.couponCode) lines.push(L.cap.coupon(o.couponCode));
  lines.push('', L.cap.delivery(s.freeAbove, s.deliveryCharge), L.cap.payment(s.payment), L.cap.contact(s.whatsapp || s.phone), `📍 ${s.address}`, L.cap.app(s.name), '');

  const tags = new Set<string>(BASE_TAGS);
  if (o.template === 'festival' && o.festivalName) {
    tags.add(tag(o.festivalName));
    if (o.lang !== 'hindi') {
      tags.add(tag(`Happy ${o.festivalName}`));
      tags.add(tag(`${o.festivalName} Offer`));
    }
    tags.add('#FestivalOffer');
  }
  if (o.template === 'daily') [...L.cap.tags, '#DealOfTheDay', '#GroceryOffers'].forEach((t) => tags.add(t));
  if (o.lang === 'hindi') tags.add('#किराना_स्टोर');
  if (s.name && tag(s.name) !== '#4astore') tags.add(tag(s.name));
  lines.push([...tags].filter((t) => t.length > 1).join(' '));
  return lines.join('\n').slice(0, 2200); // Instagram caption limit
}
