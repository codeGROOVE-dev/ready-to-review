// Shared utilities for Ready To Review

// DOM Helpers
export const $ = (id) => document.getElementById(id);
export const $$ = (selector) => document.querySelectorAll(selector);
export const show = (el) => el && el.removeAttribute("hidden");
export const hide = (el) => el && el.setAttribute("hidden", "");

// HTML escaping
export const escapeHtml = (str) => {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

// Date formatting - optimized with constants
const MS_PER_DAY = 86400000;
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;

export const formatDate = (dateString) => {
  const diffDays = Math.floor((Date.now() - new Date(dateString)) / MS_PER_DAY);
  
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < DAYS_PER_WEEK) return `${diffDays} days ago`;
  if (diffDays < DAYS_PER_MONTH) return `${Math.floor(diffDays / DAYS_PER_WEEK)} weeks ago`;
  if (diffDays < DAYS_PER_YEAR) return `${Math.floor(diffDays / DAYS_PER_MONTH)} months ago`;
  return `${Math.floor(diffDays / DAYS_PER_YEAR)} years ago`;
};

// Toast notifications - lazy initialization
let toastContainer = null;

export const showToast = (message, type = "info") => {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  // Force layout to ensure transition works
  toast.offsetHeight;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};