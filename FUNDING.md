# Funding the data Lector runs on

Lector is a reader, but the language packs are the product. Volunteers and small
research groups built the data in those packs. Almost none of them get paid for
it. This document records what Lector gives back, to whom, and why.

## The commitment

Lector pays out **$100 USD per month, or 10% of profit, whichever is greater**.

The floor applies now. Lector is not yet profitable, so the maintainer pays the
floor from a personal giving budget. The percentage takes over when 10% of
profit is more than $100 per month.

Profit means revenue after payment-processor fees, refunds, hosting, and
inference costs. Lector publishes the payments each year, not the accounts.

Lector pays once per year, in a single transfer to each recipient. Bank fees and
administration make small monthly transfers wasteful.

Every payment appears at [lector.dev/funding](https://lector.dev/funding/), with
the date, the amount, and a receipt.

## Payments so far

| Date | Recipient | Amount | Method |
| --- | --- | --- | --- |
| 22 August 2026 | Tatoeba | $600 USD, sent as EUR 513.78 | PayPal |

## Where the money goes

The annual total at the floor is $1,200.

| Recipient | Share | Amount | Channel |
| --- | --- | --- | --- |
| Tatoeba | 50% | $600 | IBAN transfer to Association Tatoeba |
| Directed work fund | 30% | $360 | Contract work on upstream projects |
| kaikki.org hosting | 20% | $240 | Offered to the maintainer directly |

### Tatoeba

Every language pack draws its sentences from [Tatoeba](https://tatoeba.org).
Association Tatoeba is a French non-profit. Donations paid for it from 2014.

Tatoeba takes IBAN transfers and PayPal. Lector uses IBAN, because PayPal takes
a percentage.

### Directed work fund

Some projects Lector depends on have no legal entity and no way to accept money.
[eSpeak NG](https://github.com/espeak-ng/espeak-ng) is one. It is the only voice
Lector has for Esperanto. [jieba](https://github.com/fxsjy/jieba) is another. It
segments every Mandarin text Lector reads.

A donation button does not exist for these projects. Paid work does. Lector
holds this share and spends it in single amounts on specific upstream jobs:

- Voice and phoneme fixes in eSpeak NG for languages that Lector ships.
- Corrections to Wiktionary entries that a pack build found missing or wrong.
  Each pack build produces this list as a by-product.

Lector reports what the fund paid for. An unspent balance carries over.

### kaikki.org

[kaikki.org](https://kaikki.org) supplies the dictionaries for most packs. Tatu
Ylonen maintains it and the [wiktextract](https://github.com/tatuylonen/wiktextract)
parser behind it.

Neither the site nor the repository asks for money. No sponsor button and no
donation page exist. Lector contacts the maintainer and offers to pay the server
cost and the data transfer for the dumps Lector downloads. If he declines, the
share moves to the directed work fund.

## Recipients that cannot take money

Research on each of these confirmed there is no way to pay them, or that payment
is the wrong offer.

**Anki.** The [Anki FAQ](https://faqs.ankiweb.net/how-can-i-donate.html) states
that Anki runs as a business and cannot easily accept donations. It asks people
to buy AnkiMobile instead. Lector buys AnkiMobile licences as a normal business
expense and does not count them in the 10%. AnkiDroid is a separate team with an
Open Collective, and becomes a candidate when the percentage clears the floor.

**wordfreq.** The frequency lists in every pack come from wordfreq. Robyn Speer
[ended the project](https://lobste.rs/s/ueqoef/why_wordfreq_will_not_be_updated)
because generative text polluted the web corpora it sampled. No work remains to
fund. Lector does not offer money to a maintainer who stopped work for that
reason.

**Wikimedia.** Wiktionary and Wikipedia dumps feed the dictionaries and the
frequency blends. The Wikimedia Foundation is very well funded, so a payment
there does the least good of any option on this list. Lector contributes to
Wiktionary through the entry corrections in the directed work fund instead.

**Academic sources.** MeCab and UniDic come from NINJAL. UDPipe and Universal
Dependencies come from Charles University. OPUS comes from the University of
Helsinki. Stanza comes from Stanford.

Their gift processes cost more in administration than $150 is worth. When the
percentage clears the floor, they become candidates.

**Standards bodies.** The Unicode Consortium supplies ICU, CLDR, and Unihan, and
the tokenizer depends on all three. The Apache Software Foundation holds
Kuromoji. Both accept donations. Both are on the list for the first year that
10% of profit is more than the floor.

## Notes

The frequency data has no upstream any more. wordfreq is finished, and the open
web corpora it used are degraded. Lector must find another frequency source or
build one. This is a product risk, and money does not solve it.

## Corrections

Open an issue if this document is wrong about data that Lector uses. Open an
issue if you know a better channel to reach a project named here.
