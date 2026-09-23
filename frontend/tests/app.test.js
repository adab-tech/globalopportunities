import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadScript } from './support/loadScript.js';
import { APP_HTML } from './support/fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

beforeAll(() => {
  document.body.innerHTML = APP_HTML;
  loadScript('js/app.js');
});

describe('esc', () => {
  it('escapes HTML-significant characters', () => {
    expect(esc('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('returns an empty string for falsy input', () => {
    expect(esc('')).toBe('');
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
});

describe('deadlineBadge', () => {
  const today = new Date();
  const isoInDays = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  it('flags a passed deadline', () => {
    expect(deadlineBadge({ deadline_at: isoInDays(-1) }).cls).toBe('tag-deadline-passed');
  });

  it('flags today as urgent', () => {
    const badge = deadlineBadge({ deadline_at: isoInDays(0) });
    expect(badge.text).toBe('Deadline is today');
    expect(badge.cls).toBe('tag-deadline-urgent');
  });

  it('flags 1 day left as urgent, singular wording', () => {
    expect(deadlineBadge({ deadline_at: isoInDays(1) }).text).toBe('1 day left');
  });

  it('flags within a week as urgent', () => {
    expect(deadlineBadge({ deadline_at: isoInDays(7) }).cls).toBe('tag-deadline-urgent');
  });

  it('flags within a month as soon, not urgent', () => {
    expect(deadlineBadge({ deadline_at: isoInDays(20) }).cls).toBe('tag-deadline-soon');
  });

  it('falls back to a plain date badge beyond a month', () => {
    expect(deadlineBadge({ deadline_at: isoInDays(90) }).cls).toBe('tag-deadline');
  });

  it('handles a rolling deadline with no parsed date', () => {
    expect(deadlineBadge({ deadline: 'Rolling' }).cls).toBe('tag-deadline-rolling');
  });

  it('falls back to "check listing" when nothing is known', () => {
    expect(deadlineBadge({}).text).toBe('Check listing for deadline');
  });
});

describe('cardHTML', () => {
  const baseOpp = {
    id: 42,
    title: 'Test Fellowship',
    opportunity_type: 'fellowship',
    scraped_at: '2026-01-01T00:00:00Z',
    url: 'https://example.org/apply',
  };

  it('never renders a non-http(s) URL as a link target', () => {
    const html = cardHTML({ ...baseOpp, url: 'javascript:alert(1)' });
    expect(html).toContain('href="#"');
    expect(html).not.toContain('javascript:alert');
  });

  it('escapes the title against injection', () => {
    const html = cardHTML({ ...baseOpp, title: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });

  it('renders a valid https URL as the real link target', () => {
    const html = cardHTML(baseOpp);
    expect(html).toContain('href="https://example.org/apply"');
  });
});

describe('pgBtn / renderPagination', () => {
  it('marks the current page active and disables the edge buttons appropriately', () => {
    state.page = 1;
    state.totalPages = 3;
    renderPagination(30);
    expect(pagination.innerHTML).toContain('disabled');
    expect(pagination.innerHTML).toMatch(/active[^>]*>1</);
  });

  it('renders nothing for a single page of results', () => {
    state.page = 1;
    state.totalPages = 1;
    renderPagination(5);
    expect(pagination.innerHTML).toBe('');
  });

  it('never emits an inline event-handler attribute (backend CSP has no unsafe-inline/unsafe-hashes; an onclick="..." attribute here is silently inert in every real browser, not just a lint nit - this exact bug shipped once already)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf-8');
    // Matches HTML attribute syntax (on<word>="...") specifically, not JS
    // identifiers like `const onCopied = ...` that happen to start with "on".
    expect(src).not.toMatch(/\son[a-z]+\s*=\s*["']/i);
  });
});

describe('search autocomplete', () => {
  beforeEach(() => {
    hideSuggestions();
    searchInput.value = '';
  });

  it('escapeHtml neutralizes markup in a suggestion', () => {
    expect(escapeHtml('<b>bold</b>')).not.toContain('<b>');
  });

  it('renderSuggestions populates the list and marks it visible', () => {
    renderSuggestions(['Chevening Scholarships', 'DAAD Scholarships']);
    expect(suggestionsList.hidden).toBe(false);
    expect(suggestionsList.querySelectorAll('.search-suggestion').length).toBe(2);
    expect(searchInput.getAttribute('aria-expanded')).toBe('true');
  });

  it('renderSuggestions with no items hides the list instead of showing empty', () => {
    renderSuggestions([]);
    expect(suggestionsList.hidden).toBe(true);
  });

  it('hideSuggestions clears the list and resets aria-expanded', () => {
    renderSuggestions(['Something']);
    hideSuggestions();
    expect(suggestionsList.hidden).toBe(true);
    expect(suggestionsList.innerHTML).toBe('');
    expect(searchInput.getAttribute('aria-expanded')).toBe('false');
  });

  it('setActiveSuggestion highlights exactly one item', () => {
    renderSuggestions(['A', 'B', 'C']);
    setActiveSuggestion(1);
    const items = suggestionsList.querySelectorAll('.search-suggestion');
    expect(items[0].classList.contains('is-active')).toBe(false);
    expect(items[1].classList.contains('is-active')).toBe(true);
    expect(items[2].classList.contains('is-active')).toBe(false);
  });

  it('chooseSuggestion fills the search box and closes the dropdown', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ total_pages: 1, data: [], total: 0 }),
    });
    renderSuggestions(['Chevening Scholarships']);
    chooseSuggestion('Chevening Scholarships');
    expect(searchInput.value).toBe('Chevening Scholarships');
    expect(suggestionsList.hidden).toBe(true);
  });
});

describe('copy-to-clipboard button', () => {
  it('copies the address via the Clipboard API and shows confirmation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const btn = document.createElement('button');
    btn.dataset.email = 'hello@globalopportunities.app';
    btn.innerHTML = '<span class="copy-btn-label">Copy</span>';

    onCopyEmail({ currentTarget: btn });
    await Promise.resolve();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('hello@globalopportunities.app');
    expect(btn.classList.contains('is-copied')).toBe(true);
    expect(btn.querySelector('.copy-btn-label').textContent).toBe('Copied!');
  });
});

/* Runs last in this file deliberately: bindEvents() wires up every listener
   on the page (search, filters, save modal, pagination, ...) for real, the
   same way DOMContentLoaded does in production, so it must not run before
   earlier tests that assume nothing is bound yet. */
describe('pagination click delegation (regression: CSP has no unsafe-inline)', () => {
  it('clicking a rendered page button actually changes the page', () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], total: 30, total_pages: 3 }),
    });
    bindEvents();
    state.page = 1;
    state.totalPages = 3;
    renderPagination(30);

    const nextBtn = [...pagination.querySelectorAll('.page-btn')]
      .find(b => b.textContent.includes('Next'));
    nextBtn.click();

    expect(state.page).toBe(2);
  });
});
