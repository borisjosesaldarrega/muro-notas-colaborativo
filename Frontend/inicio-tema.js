'use strict';

try {
  document.documentElement.dataset.theme = localStorage.getItem('muroTheme') || 'light';
} catch {
  document.documentElement.dataset.theme = 'light';
}
