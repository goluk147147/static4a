// Built-in video text in three languages. "hinglish" = the original Roman-script copy.
// Hindi uses Devanagari (bundled Noto Sans Devanagari); English is plain English.
import type { Lang } from './types';

const inr = (n: number) => '₹' + n.toLocaleString('en-IN');

export interface Strings {
  hook: [string, string, string];
  staples: string;
  whyTitle: string;
  why: (store: string) => string;
  features: (free: number, charge: number) => { icon: string; title: string; sub: string }[];
  stepsTitle: [string, string];
  steps: { icon: string; label: string }[];
  ctaTop: (festival: string | null) => string;
  ctaMain: string;
  whatsapp: string;
  downloadApp: (store: string) => string;
  freeDeliveryLine: (free: number) => string;
  fromStore: (store: string) => string;
  family: (store: string) => string;
  wishesTo: string;
  offerHeading: (festival: string | null) => string;
  couponLabel: string;
  onlyAt: (store: string) => string;
  deliveryShort: (free: number, charge: number) => string;
  festSpecial: (festival: string) => string;
  festSpecialSub: string;
  dailyTitle: string;
  dealOfDay: string;
  dailySub: (store: string) => string;
  dealsTitle: string;
  dealsSub: string;
  off: (pct: number) => string;
  dateLocale: string;
  defaultOffer: string;
  happy: (festival: string) => string;
  // captions
  cap: {
    festivalWish: (store: string, festival: string) => string;
    dailyHead: (title: string, store: string) => string;
    dailyItem: (name: string, price: string, mrp: string | null) => string;
    generalHead: (store: string, tagline: string) => string;
    generalBody: string;
    coupon: (code: string) => string;
    delivery: (free: number, charge: number) => string;
    payment: (p: string) => string;
    contact: (phone: string) => string;
    app: (store: string) => string;
    tags: string[]; // language-specific extra hashtags
  };
}

const hinglish: Strings = {
  hook: ['Ghar Baithe', 'Grocery', 'Mangaiye!'],
  staples: 'Atta • Daal • Chawal • Doodh • Sabzi',
  whyTitle: 'Kyun Chunein',
  why: (s) => `${s}?`,
  features: (free, charge) => [
    { icon: '🥬', title: 'Fresh & Quality Products', sub: 'Roz ki zaroorat ka har saman' },
    { icon: '🚚', title: `FREE Delivery ${inr(free)}+`, sub: `Baaki orders par sirf ${inr(charge)}` },
    { icon: '📱', title: 'Easy UPI Payment', sub: 'GPay • PhonePe • Paytm' },
    { icon: '💬', title: 'WhatsApp Order Updates', sub: 'Har order ki turant jaankari' },
  ],
  stepsTitle: ['Order Karna Hai', 'Bilkul Aasaan!'],
  steps: [
    { icon: '🔍', label: 'Product Chuniye' },
    { icon: '🛒', label: 'Cart Mein Daaliye' },
    { icon: '💳', label: 'UPI Se Pay Kariye' },
    { icon: '🏠', label: 'Ghar Par Delivery' },
  ],
  ctaTop: (f) => (f ? `Is ${f} par` : 'Aaj Hi'),
  ctaMain: 'Order Karein!',
  whatsapp: 'WhatsApp',
  downloadApp: (s) => `Download ${s} App`,
  freeDeliveryLine: (free) => `FREE delivery ${inr(free)} se upar ke order par`,
  fromStore: (s) => `${s} ki taraf se`,
  family: (s) => `${s} Parivaar`,
  wishesTo: 'ki taraf se aapko',
  offerHeading: (f) => (f ? `${f} Offer` : 'Special Offer'),
  couponLabel: 'Coupon Code',
  onlyAt: (s) => `Sirf ${s} par • Limited time`,
  deliveryShort: (free, charge) => `FREE delivery ${inr(free)}+ • baaki sirf ${inr(charge)}`,
  festSpecial: (f) => `${f} Special`,
  festSpecialSub: 'Tyohar ki taiyari, ek hi jagah',
  dailyTitle: 'Aaj ka Special',
  dealOfDay: 'Deal of the Day',
  dailySub: (s) => `Sirf ${s} par • Aaj hi order karein`,
  dealsTitle: 'Aaj ke Deals',
  dealsSub: 'MRP se kam daam • Ghar par delivery',
  off: (p) => `${p}% OFF`,
  dateLocale: 'en-IN',
  defaultOffer: 'Har order par bachat',
  happy: (f) => `Happy ${f}!`,
  cap: {
    festivalWish: (s, f) => `${s} parivaar ki taraf se aapko aur aapke parivaar ko ${f || 'tyohar'} ki dher saari shubhkamnayein! 🙏`,
    dailyHead: (t, s) => `🔥 ${t} — ${s} par!`,
    dailyItem: (n, p, m) => `✅ ${n} — sirf ${p}${m ? ` (MRP ${m})` : ''}`,
    generalHead: (s, tg) => `🛒 ${s} — ${tg}`,
    generalBody: 'Ghar baithe grocery mangaiye! Atta, daal, chawal, doodh, sabzi — sab kuch ek jagah. 🥬🥛',
    coupon: (c) => `🏷️ Coupon code: ${c}`,
    delivery: (free, charge) => `🚚 FREE delivery ${inr(free)} se upar • baaki sirf ${inr(charge)}`,
    payment: (p) => `💳 Payment: ${p}`,
    contact: (ph) => `📞 Call / 💬 WhatsApp: ${ph}`,
    app: (s) => `📲 ${s} app download karein aur aaj hi order karein!`,
    tags: ['#AajKaSpecial'],
  },
};

const hindi: Strings = {
  hook: ['घर बैठे', 'राशन', 'मँगाइए!'],
  staples: 'आटा • दाल • चावल • दूध • सब्ज़ी',
  whyTitle: 'क्यों चुनें',
  why: (s) => `${s}?`,
  features: (free, charge) => [
    { icon: '🥬', title: 'ताज़ा और बढ़िया सामान', sub: 'रोज़ की ज़रूरत की हर चीज़' },
    { icon: '🚚', title: `${inr(free)}+ पर फ्री डिलीवरी`, sub: `बाकी ऑर्डर पर सिर्फ़ ${inr(charge)}` },
    { icon: '📱', title: 'आसान UPI पेमेंट', sub: 'GPay • PhonePe • Paytm' },
    { icon: '💬', title: 'WhatsApp पर ऑर्डर अपडेट', sub: 'हर ऑर्डर की तुरंत जानकारी' },
  ],
  stepsTitle: ['ऑर्डर करना है', 'बिल्कुल आसान!'],
  steps: [
    { icon: '🔍', label: 'सामान चुनिए' },
    { icon: '🛒', label: 'कार्ट में डालिए' },
    { icon: '💳', label: 'UPI से पेमेंट कीजिए' },
    { icon: '🏠', label: 'घर पर डिलीवरी' },
  ],
  ctaTop: (f) => (f ? `इस ${f} पर` : 'आज ही'),
  ctaMain: 'ऑर्डर करें!',
  whatsapp: 'WhatsApp',
  downloadApp: (s) => `${s} ऐप डाउनलोड करें`,
  freeDeliveryLine: (free) => `${inr(free)} से ऊपर के ऑर्डर पर फ्री डिलीवरी`,
  fromStore: (s) => `${s} की ओर से`,
  family: (s) => `${s} परिवार`,
  wishesTo: 'की ओर से आपको',
  offerHeading: (f) => (f ? `${f} ऑफ़र` : 'स्पेशल ऑफ़र'),
  couponLabel: 'कूपन कोड',
  onlyAt: (s) => `सिर्फ़ ${s} पर • सीमित समय`,
  deliveryShort: (free, charge) => `${inr(free)}+ पर फ्री डिलीवरी • बाकी सिर्फ़ ${inr(charge)}`,
  festSpecial: (f) => `${f} स्पेशल`,
  festSpecialSub: 'त्योहार की तैयारी, एक ही जगह',
  dailyTitle: 'आज का स्पेशल',
  dealOfDay: 'आज की डील',
  dailySub: (s) => `सिर्फ़ ${s} पर • आज ही ऑर्डर करें`,
  dealsTitle: 'आज की डील्स',
  dealsSub: 'MRP से कम दाम • घर पर डिलीवरी',
  off: (p) => `${p}% छूट`,
  dateLocale: 'hi-IN',
  defaultOffer: 'हर ऑर्डर पर बचत',
  happy: (f) => `${f} की शुभकामनाएँ!`,
  cap: {
    festivalWish: (s, f) => `${s} परिवार की ओर से आपको और आपके परिवार को ${f || 'त्योहार'} की ढेर सारी शुभकामनाएँ! 🙏`,
    dailyHead: (t, s) => `🔥 ${t} — ${s} पर!`,
    dailyItem: (n, p, m) => `✅ ${n} — सिर्फ़ ${p}${m ? ` (MRP ${m})` : ''}`,
    generalHead: (s, tg) => `🛒 ${s} — ${tg}`,
    generalBody: 'घर बैठे राशन मँगाइए! आटा, दाल, चावल, दूध, सब्ज़ी — सब कुछ एक ही जगह। 🥬🥛',
    coupon: (c) => `🏷️ कूपन कोड: ${c}`,
    delivery: (free, charge) => `🚚 ${inr(free)} से ऊपर फ्री डिलीवरी • बाकी सिर्फ़ ${inr(charge)}`,
    payment: (p) => `💳 पेमेंट: ${p}`,
    contact: (ph) => `📞 कॉल / 💬 WhatsApp: ${ph}`,
    app: (s) => `📲 ${s} ऐप डाउनलोड करें और आज ही ऑर्डर करें!`,
    tags: ['#आज_का_स्पेशल', '#किराना'],
  },
};

const english: Strings = {
  hook: ['Order Your', 'Groceries', 'From Home!'],
  staples: 'Atta • Dal • Rice • Milk • Veggies',
  whyTitle: 'Why Choose',
  why: (s) => `${s}?`,
  features: (free, charge) => [
    { icon: '🥬', title: 'Fresh & Quality Products', sub: 'Everything you need, every day' },
    { icon: '🚚', title: `FREE Delivery on ${inr(free)}+`, sub: `Only ${inr(charge)} on other orders` },
    { icon: '📱', title: 'Easy UPI Payment', sub: 'GPay • PhonePe • Paytm' },
    { icon: '💬', title: 'WhatsApp Order Updates', sub: 'Instant updates on every order' },
  ],
  stepsTitle: ['Ordering is', 'Super Easy!'],
  steps: [
    { icon: '🔍', label: 'Pick Your Products' },
    { icon: '🛒', label: 'Add to Cart' },
    { icon: '💳', label: 'Pay with UPI' },
    { icon: '🏠', label: 'Delivered Home' },
  ],
  ctaTop: (f) => (f ? `This ${f},` : "Don't Wait,"),
  ctaMain: 'Order Now!',
  whatsapp: 'WhatsApp',
  downloadApp: (s) => `Download the ${s} App`,
  freeDeliveryLine: (free) => `FREE delivery on orders above ${inr(free)}`,
  fromStore: (s) => `From all of us at ${s}`,
  family: (s) => `The ${s} Family`,
  wishesTo: 'wishes you',
  offerHeading: (f) => (f ? `${f} Offer` : 'Special Offer'),
  couponLabel: 'Coupon Code',
  onlyAt: (s) => `Only at ${s} • Limited time`,
  deliveryShort: (free, charge) => `FREE delivery on ${inr(free)}+ • else ${inr(charge)}`,
  festSpecial: (f) => `${f} Specials`,
  festSpecialSub: 'Everything for the festival, in one place',
  dailyTitle: "Today's Special",
  dealOfDay: 'Deal of the Day',
  dailySub: (s) => `Only at ${s} • Order today`,
  dealsTitle: "Today's Deals",
  dealsSub: 'Below MRP • Home delivery',
  off: (p) => `${p}% OFF`,
  dateLocale: 'en-IN',
  defaultOffer: 'Savings on every order',
  happy: (f) => `Happy ${f}!`,
  cap: {
    festivalWish: (s, f) => `Warm ${f || 'festival'} wishes to you and your family from everyone at ${s}! 🙏`,
    dailyHead: (t, s) => `🔥 ${t} at ${s}!`,
    dailyItem: (n, p, m) => `✅ ${n} — just ${p}${m ? ` (MRP ${m})` : ''}`,
    generalHead: (s, tg) => `🛒 ${s} — ${tg}`,
    generalBody: 'Order groceries from home! Atta, dal, rice, milk, veggies — everything in one place. 🥬🥛',
    coupon: (c) => `🏷️ Coupon code: ${c}`,
    delivery: (free, charge) => `🚚 FREE delivery above ${inr(free)} • otherwise only ${inr(charge)}`,
    payment: (p) => `💳 Payment: ${p}`,
    contact: (ph) => `📞 Call / 💬 WhatsApp: ${ph}`,
    app: (s) => `📲 Download the ${s} app and order today!`,
    tags: ['#TodaysSpecial', '#GroceryDeals'],
  },
};
export const STRINGS: Record<Lang, Strings> = { hinglish, hindi, english };
export const T = (lang: Lang | undefined) => STRINGS[lang || 'hinglish'] || hinglish;
