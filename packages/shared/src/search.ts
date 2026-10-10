// Подготовка поискового запроса по адресу. Адреса в основном на русском, поэтому кроме
// исходного текста ищем по вариантам: исправленная раскладка и транслит латиницы.

// Та же нормализация, что у колонки delivery_address_search в БД: нижний регистр, ё → е.
export function normalizeSearchText(text: string): string {
  return text.toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ').trim();
}

// Клавиши QWERTY → ЙЦУКЕН (одна и та же физическая клавиша).
const LATIN_TO_CYRILLIC_LAYOUT: Record<string, string> = {
  q: 'й',
  w: 'ц',
  e: 'у',
  r: 'к',
  t: 'е',
  y: 'н',
  u: 'г',
  i: 'ш',
  o: 'щ',
  p: 'з',
  '[': 'х',
  ']': 'ъ',
  a: 'ф',
  s: 'ы',
  d: 'в',
  f: 'а',
  g: 'п',
  h: 'р',
  j: 'о',
  k: 'л',
  l: 'д',
  ';': 'ж',
  "'": 'э',
  z: 'я',
  x: 'ч',
  c: 'с',
  v: 'м',
  b: 'и',
  n: 'т',
  m: 'ь',
  ',': 'б',
  '.': 'ю',
  '`': 'ё',
};

const CYRILLIC_TO_LATIN_LAYOUT: Record<string, string> = Object.fromEntries(
  Object.entries(LATIN_TO_CYRILLIC_LAYOUT).map(([latin, cyrillic]) => [cyrillic, latin]),
);

function mapChars(text: string, table: Record<string, string>): string {
  return [...text].map((char) => table[char] ?? char).join('');
}

// «cfljdfz» → «садовая»: набрали русское слово в английской раскладке.
export function toCyrillicLayout(text: string): string {
  return mapChars(text.toLowerCase(), LATIN_TO_CYRILLIC_LAYOUT);
}

// «щфл» → «oak»: набрали английское слово в русской раскладке.
export function toLatinLayout(text: string): string {
  return mapChars(text.toLowerCase(), CYRILLIC_TO_LATIN_LAYOUT);
}

// Сочетания проверяются раньше одиночных букв: «shch» раньше «sh», «sh» раньше «s».
const TRANSLIT_COMBINATIONS: readonly [string, string][] = [
  ['shch', 'щ'],
  ['sch', 'щ'],
  ['zh', 'ж'],
  ['kh', 'х'],
  ['ts', 'ц'],
  ['ch', 'ч'],
  ['sh', 'ш'],
  ['yu', 'ю'],
  ['ju', 'ю'],
  ['ya', 'я'],
  ['ja', 'я'],
  ['yo', 'е'],
  ['jo', 'е'],
  ['ye', 'е'],
];

const TRANSLIT_LETTERS: Record<string, string> = {
  a: 'а',
  b: 'б',
  c: 'к',
  d: 'д',
  e: 'е',
  f: 'ф',
  g: 'г',
  h: 'х',
  i: 'и',
  j: 'й',
  k: 'к',
  l: 'л',
  m: 'м',
  n: 'н',
  o: 'о',
  p: 'п',
  q: 'к',
  r: 'р',
  s: 'с',
  t: 'т',
  u: 'у',
  v: 'в',
  w: 'в',
  x: 'кс',
  z: 'з',
  "'": 'ь',
};

const LATIN_VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

// «sadovaya» → «садовая». Правила транслита неоднозначны (ya/ja, kh/h), поэтому результат
// приблизительный — дальше его прощает нечёткий поиск по триграммам.
export function transliterateToCyrillic(text: string): string {
  const source = text.toLowerCase();
  let result = '';
  let i = 0;
  while (i < source.length) {
    const combination = TRANSLIT_COMBINATIONS.find(([latin]) => source.startsWith(latin, i));
    if (combination) {
      result += combination[1];
      i += combination[0].length;
      continue;
    }
    const char = source.charAt(i);
    if (char === 'y') {
      // После гласной y — это «й» (tverskoy → тверской), иначе — «ы».
      result += LATIN_VOWELS.has(source.charAt(i - 1)) ? 'й' : 'ы';
    } else {
      result += TRANSLIT_LETTERS[char] ?? char;
    }
    i += 1;
  }
  return result;
}

const HAS_LATIN = /[a-z]/;
const HAS_CYRILLIC = /[а-я]/;

// Все варианты запроса без повторов. Первый — сам запрос после нормализации.
export function searchVariants(query: string): string[] {
  const base = normalizeSearchText(query);
  const variants = [base];
  if (HAS_LATIN.test(base)) {
    variants.push(normalizeSearchText(toCyrillicLayout(base)));
    variants.push(normalizeSearchText(transliterateToCyrillic(base)));
  }
  if (HAS_CYRILLIC.test(base)) {
    variants.push(normalizeSearchText(toLatinLayout(base)));
  }
  return [...new Set(variants)].filter((variant) => variant.length > 0);
}
