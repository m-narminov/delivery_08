import { describe, expect, it } from 'vitest';
import {
  normalizeSearchText,
  searchVariants,
  toCyrillicLayout,
  toLatinLayout,
  transliterateToCyrillic,
} from './search';

describe('normalizeSearchText', () => {
  it('приводит к нижнему регистру, заменяет ё на е и схлопывает пробелы', () => {
    expect(normalizeSearchText('  ул.  КОРОЛЁВА   5 ')).toBe('ул. королева 5');
  });
});

describe('раскладка клавиатуры', () => {
  it.each([
    ['cfljdfz', 'садовая'],
    ['ktybyf', 'ленина'],
    ['CFLJDFZ', 'садовая'],
    ['rjhjk`df', 'королёва'],
  ])('%s → %s', (typed, expected) => {
    expect(toCyrillicLayout(typed)).toBe(expected);
  });

  it('обратно: русская раскладка → латиница', () => {
    expect(toLatinLayout('щфл')).toBe('oak');
  });

  it('символы вне таблицы не трогает', () => {
    expect(toCyrillicLayout('12-5')).toBe('12-5');
  });
});

describe('transliterateToCyrillic', () => {
  it.each([
    ['sadovaya', 'садовая'],
    ['tverskaya', 'тверская'],
    ['leninskiy', 'ленинский'],
    ['tverskoy', 'тверской'],
    ['shchukinskaya', 'щукинская'],
    ['zhukova', 'жукова'],
    ['khamovniki', 'хамовники'],
    ['yakimanka', 'якиманка'],
    ['tsvetnoy', 'цветной'],
    ['kutuzovskiy prospekt 12', 'кутузовский проспект 12'],
  ])('%s → %s', (latin, expected) => {
    expect(transliterateToCyrillic(latin)).toBe(expected);
  });
});

describe('searchVariants', () => {
  it('русский запрос: сам запрос и вариант в английской раскладке', () => {
    expect(searchVariants('Королёва')).toEqual(['королева', 'rjhjktdf']);
  });

  it('латиница: запрос, исправленная раскладка и транслит', () => {
    expect(searchVariants('sadovaya')).toEqual(['sadovaya', 'ыфвщмфнф', 'садовая']);
  });

  it('пустой запрос — пустой список', () => {
    expect(searchVariants('   ')).toEqual([]);
  });

  it('цифры без букв — только сам запрос', () => {
    expect(searchVariants('15')).toEqual(['15']);
  });

  it('варианты не повторяются', () => {
    const variants = searchVariants('cfljdfz');
    expect(new Set(variants).size).toBe(variants.length);
    expect(variants).toContain('садовая');
  });
});
