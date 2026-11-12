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
                const response = await fetch('/api/subscribe', {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        email: emailValue,
                        source: 'Site General Newsletter'
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

// ==========================================
//  Solar Sem Limites 2027: chamada temporária (12/11 a 01/12/2026)
//  Até 25/11, às 8h (Belém), leva para a Lista VIP; até 01/12, às 23h59,
//  para a página de vendas; depois disso, some sozinha e a home volta a
//  mostrar a newsletter. Para conferir uma fase: ?ssl27=vip | vendas | fim
// ==========================================
(function () {
    var ABRE_VENDAS = Date.UTC(2026, 10, 25, 11, 0, 0); // 25/11/2026, 8h em Belém
    var FECHA = Date.UTC(2026, 11, 2, 3, 0, 0);         // 01/12/2026, 23h59 em Belém
    var teste = (location.search.match(/[?&]ssl27=(vip|vendas|fim)(&|$)/) || [])[1];
    var agora = Date.now();
    var fase = teste || (agora >= FECHA ? 'fim' : agora >= ABRE_VENDAS ? 'vendas' : 'vip');
    if (fase === 'fim') return;

    var destino = fase === 'vip' ? '/vip' : '/solarsemlimites2027';
    var link = function (meio) {
        return destino + '?utm_source=site&utm_medium=' + meio + '&utm_campaign=ssl27_site';
    };
    var T = {
        vip: {
            longo: '<strong>Solar Sem Limites 2027</strong> · Visita guiada ao vivo em 24/11, às 19h <span class="ssl27-faixa__cta">Entre na Lista VIP →</span>',
            curto: '<strong>Solar Sem Limites 2027</strong> <span class="ssl27-faixa__cta">Lista VIP →</span>',
            seloTag: 'Novidade',
            selo: '<strong>Solar Sem Limites 2027</strong> · visita guiada ao vivo em 24/11, às 19h →',
            botao: 'Entrar na Lista VIP',
            fechamento: 'Valores e detalhes na visita guiada ao vivo, em 24/11, às 19h.'
        },
        vendas: {
            longo: '<strong>Solar Sem Limites 2027</strong> · Vendas abertas até 01/12, às 23h59 <span class="ssl27-faixa__cta">Conheça o pacote →</span>',
            curto: '<strong>Solar Sem Limites 2027</strong> <span class="ssl27-faixa__cta">Vendas até 01/12 →</span>',
            seloTag: 'Vendas abertas',
            selo: '<strong>Solar Sem Limites 2027</strong> · até 01/12, às 23h59 →',
            botao: 'Conhecer o pacote',
            fechamento: 'Vendas abertas até 01/12, às 23h59.'
        }
    }[fase];

    var iniciar = function () {
        // Faixa no topo de todas as páginas que carregam este arquivo.
        var fechada = false;
        try { fechada = sessionStorage.getItem('ssl27_faixa_fechada') === '1'; } catch (e) { }
        if (!fechada) {
            var faixa = document.createElement('div');
            faixa.className = 'ssl27-faixa';
            faixa.setAttribute('role', 'region');
            faixa.setAttribute('aria-label', 'Solar Sem Limites 2027');
            faixa.innerHTML = '<a class="ssl27-faixa__link" href="' + link('faixa') + '">' +
                '<span class="ssl27-faixa__longo">' + T.longo + '</span>' +
                '<span class="ssl27-faixa__curto">' + T.curto + '</span></a>' +
                '<button type="button" class="ssl27-faixa__fechar" aria-label="Fechar aviso">×</button>';
            document.body.insertBefore(faixa, document.body.firstChild);
            document.body.classList.add('com-faixa-ssl27');
            var ajustar = function () {
                document.documentElement.style.setProperty('--faixa-ssl27', faixa.offsetHeight + 'px');
            };
            ajustar();
            window.addEventListener('resize', ajustar);
            faixa.querySelector('.ssl27-faixa__fechar').addEventListener('click', function () {
                faixa.remove();
                document.body.classList.remove('com-faixa-ssl27');
                try { sessionStorage.setItem('ssl27_faixa_fechada', '1'); } catch (e) { }
            });
        }

        // Home: selo acima do título do hero.
        var heroTitulo = document.querySelector('#inicio .hero__title');
        if (heroTitulo) {
            var selo = document.createElement('a');
            selo.className = 'ssl27-hero-selo';
            selo.href = link('hero');
            selo.innerHTML = '<span class="ssl27-hero-selo__tag">' + T.seloTag + '</span>' +
                '<span class="ssl27-hero-selo__longo">' + T.selo + '</span>' +
                '<span class="ssl27-hero-selo__curto"><strong>Solar Sem Limites 2027</strong> →</span>';
            heroTitulo.parentNode.insertBefore(selo, heroTitulo);
            document.body.classList.add('com-selo-ssl27');
        }

        // Home: o convite logo abaixo do hero (a newsletter some) e o cartão em Pacotes.
        document.querySelectorAll('[data-ssl27]').forEach(function (el) { el.hidden = false; });
        document.querySelectorAll('[data-ssl27-esconder]').forEach(function (el) { el.hidden = true; });
        document.querySelectorAll('[data-ssl27-link]').forEach(function (el) {
            el.href = link(el.getAttribute('data-ssl27-link'));
        });
        document.querySelectorAll('[data-ssl27-texto]').forEach(function (el) {
            el.textContent = T[el.getAttribute('data-ssl27-texto')];
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
