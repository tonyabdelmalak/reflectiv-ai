// script.js
// Simple client-side behaviours for the Reflectiv landing page.

document.addEventListener('DOMContentLoaded', () => {
  const navToggle = document.getElementById('navToggle');
  const navMenu = document.getElementById('navMenu');
  const yearSpan = document.getElementById('year');

  // Theme toggle setup
  const themeToggle = document.getElementById('themeToggle');
  const body = document.body;
  // Restore saved theme preference from localStorage
  const savedTheme = localStorage.getItem('theme') || 'light';
  if (savedTheme === 'dark') {
    body.classList.add('dark-theme');
  }
  // Update theme toggle label based on current theme
  // Always display a neutral label instead of sun/moon icons
  const updateThemeLabel = () => {
    if (themeToggle) {
      // Keep the label consistent regardless of theme
      themeToggle.textContent = 'Theme';
    }
  };
  // Initialise label on page load
  updateThemeLabel();
  // Toggle theme on button click and persist preference
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      body.classList.toggle('dark-theme');
      const newTheme = body.classList.contains('dark-theme') ? 'dark' : 'light';
      localStorage.setItem('theme', newTheme);
      updateThemeLabel();
    });
  }

  // Toggle navigation menu on small screens
  if (navToggle && navMenu) {
    navToggle.addEventListener('click', () => {
      navMenu.classList.toggle('active');
    });
  }

  // Update year in footer
  if (yearSpan) {
    const currentYear = new Date().getFullYear();
    yearSpan.textContent = currentYear;
  }

  // IntersectionObserver for fade-in animations on scroll
  const hiddenElements = document.querySelectorAll('.hidden');
  const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('fade-in');
        entry.target.classList.remove('hidden');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  hiddenElements.forEach(el => observer.observe(el));
});