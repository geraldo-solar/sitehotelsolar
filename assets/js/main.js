// ==========================================
//  Hotel Solar - Main JavaScript
// ==========================================

document.addEventListener('DOMContentLoaded', () => {

    // --- Header Scrolled Effect ---
    const header = document.getElementById('header');

    const handleScroll = () => {
        if (window.scrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll(); // Check on load

    // --- Mobile Menu Toggle ---
    const menuToggle = document.querySelector('.menu-toggle');
    const navMenu = document.getElementById('nav-menu');
    const navLinks = document.querySelectorAll('.nav__link');
    const logoImg = document.querySelector('.logo__img');

    const toggleMenu = () => {
        menuToggle.classList.toggle('active');
        navMenu.classList.toggle('active');

        // Ensure logo is dark when menu is open on mobile if not scrolled
        if (navMenu.classList.contains('active')) {
            logoImg.style.filter = 'brightness(0) invert(0)'; // Ajustar conforme a cor da logo
        } else {
            if (window.scrollY <= 50) {
                logoImg.style.filter = '';
            } else {
                logoImg.style.filter = ''; // reset to CSS
            }
        }
    };

    if (menuToggle) {
        menuToggle.addEventListener('click', toggleMenu);
    }

    // Close menu when a link is clicked
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (navMenu.classList.contains('active')) {
                toggleMenu();
            }
        });
    });

    // --- FAQ Accordion Logic ---
    const faqQuestions = document.querySelectorAll('.faq__question');

    faqQuestions.forEach(question => {
        question.addEventListener('click', () => {
            const isExpanded = question.getAttribute('aria-expanded') === 'true';

            // Close all other open answers
            faqQuestions.forEach(q => {
                if (q !== question) {
                    q.setAttribute('aria-expanded', 'false');
                    q.nextElementSibling.style.maxHeight = null;
                }
            });

            // Toggle current answer
            question.setAttribute('aria-expanded', !isExpanded);
            const answer = question.nextElementSibling;

            if (!isExpanded) {
                // If it was closed, open it
                answer.style.maxHeight = answer.scrollHeight + "px";
            } else {
                // If it was open, close it
                answer.style.maxHeight = null;
            }
        });
    });

    // --- Intersection Observer for Animations ---
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };

    const fadeObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('.fade-up').forEach(el => {
        fadeObserver.observe(el);
    });

    // --- Newsletter / Brevo API Integration ---
    const newsletterForm = document.getElementById('newsletterForm');
    const newsletterEmail = document.getElementById('newsletterEmail');
    const newsletterBtn = document.getElementById('newsletterBtn');
    const newsletterMessage = document.getElementById('newsletterMessage');

    if (newsletterForm) {
        newsletterForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const emailValue = newsletterEmail.value.trim();
            if (!emailValue) return;

            // UI Feedback
            newsletterBtn.textContent = 'Enviando...';
            newsletterBtn.disabled = true;
            newsletterMessage.style.display = 'none';

            try {
                const response = await fetch('https://api.brevo.com/v3/contacts', {
                    method: 'POST',
                    headers: {
                        'accept': 'application/json',
                        'api-key': 'SUA_CHAVE_API_BREVO_AQUI',
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        email: emailValue,
                        listIds: [10],
                        updateEnabled: true
                    })
                });

                if (response.ok || response.status === 201 || response.status === 204) {
                    newsletterMessage.style.color = 'var(--color-secondary)';
                    newsletterMessage.textContent = 'Obrigado! Seu e-mail foi cadastrado com sucesso para receber nossas novidades.';
                    newsletterForm.reset();
                } else {
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'Erro ao cadastrar e-mail');
                }
            } catch (error) {
                console.error('Brevo API Error:', error);
                newsletterMessage.style.color = '#ff6b6b';
                newsletterMessage.textContent = 'Ops! Não foi possível realizar o cadastro agora. Tente novamente mais tarde.';
            } finally {
                newsletterMessage.style.display = 'block';
                newsletterBtn.textContent = 'Participar';
                newsletterBtn.disabled = false;
            }
        });
    }

});
