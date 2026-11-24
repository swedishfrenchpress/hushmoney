// The bitcoin sign for the big numbers. It is Inter Display's own ₿, so the sign and the
// digits are one hand, one weight and one width; the Olline B the project tried first was
// far heavier than any digit it stood next to. Screen readers hear "21 sats".

export const BTC_MARK = '<span class="btc" aria-hidden="true">₿</span>';

export const btc = (amount: number | string) =>
  `<span class="amt" aria-hidden="true">${BTC_MARK}<span class="val">${amount}</span></span><span class="sr">${amount} sats</span>`;
