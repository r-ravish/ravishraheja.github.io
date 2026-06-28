document.addEventListener('DOMContentLoaded', () => {
  /* =========================================================================
     0. Hamburger Menu Toggle
     ========================================================================= */
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');
  
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      navLinks.classList.toggle('open');
      document.body.style.overflow = navLinks.classList.contains('open') ? 'hidden' : '';
    });

    // Close menu when a link is clicked
    navLinks.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navLinks.classList.remove('open');
        document.body.style.overflow = '';
      });
    });
  }

  /* =========================================================================
     1. Scroll Reveal Animations
     ========================================================================= */
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { root: null, rootMargin: '0px', threshold: 0.1 });

  document.querySelectorAll('.animate-up').forEach(el => revealObserver.observe(el));

  /* =========================================================================
     2. Dark Container Scroll Scaling
     ========================================================================= */
  const darkContainer = document.querySelector('.dark-container');
  if (darkContainer) {
    let ticking = false;
    const updateDarkContainer = () => {
      const rect = darkContainer.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      
      // Calculate progress:
      // 0 when top is at the bottom of the viewport
      // 1 when top reaches 30% of the viewport (meaning the section is perfectly centered)
      let progress = (windowHeight - rect.top) / (windowHeight * 0.7);
      progress = Math.max(0, Math.min(1, progress));
      
      // Scale from 0.7 to 1.05, hitting max size when centered
      const scale = 0.7 + (0.35 * progress);
      // Opacity from 0.3 to 1
      const opacity = 0.3 + (0.7 * progress);
      
      darkContainer.style.transform = `scale(${scale})`;
      darkContainer.style.opacity = opacity;
      
      if (progress > 0.5) {
        darkContainer.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.1), 0 40px 80px rgba(0,0,0,0.2), 0 0 120px rgba(66, 133, 244, 0.15)';
      } else {
        darkContainer.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.05), 0 30px 60px rgba(0,0,0,0.1), 0 0 100px rgba(66, 133, 244, 0.1)';
      }
      ticking = false;
    };
    
    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(updateDarkContainer);
        ticking = true;
      }
    }, { passive: true });
    
    updateDarkContainer();
  }

  /* =========================================================================
     3. Typewriter Effect
     ========================================================================= */
  const typewriterElements = document.querySelectorAll('.typewriter');
  
  typewriterElements.forEach(el => {
    const textNode = Array.from(el.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
    if (!textNode) return;
    
    const fullText = textNode.textContent.trim();
    textNode.textContent = '';
    el.dataset.fullText = fullText;
  });

  const typewriterObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const textToType = el.dataset.fullText;
        if (!textToType) return;
        
        const cursor = el.querySelector('.gradient-cursor');
        if(cursor) cursor.classList.add('active');

        let textNode = Array.from(el.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
        if (!textNode) {
          textNode = document.createTextNode('');
          el.insertBefore(textNode, el.firstChild);
        }

        let i = 0;
        function typeChar() {
          if (i < textToType.length) {
            textNode.textContent += textToType.charAt(i);
            i++;
            setTimeout(typeChar, 30 + Math.random() * 30);
          }
        }
        
        typeChar();
        observer.unobserve(el);
      }
    });
  }, { threshold: 0.5 });

  typewriterElements.forEach(el => typewriterObserver.observe(el));

  /* =========================================================================
     4. Wavy Marquee (Bobbing and Horizontal Scroll)
     ========================================================================= */
  const marqueeTrack = document.getElementById('marqueeTrack');
  const SKILLS_DATA = [
    { class: 'devicon-python-plain colored', url: 'https://www.python.org/' },
    { class: 'devicon-html5-plain colored', url: 'https://developer.mozilla.org/en-US/docs/Web/HTML' },
    { class: 'devicon-java-plain colored', url: 'https://www.java.com/' },
    { class: 'devicon-react-original colored', url: 'https://react.dev/' },
    { class: 'devicon-cplusplus-plain colored', url: 'https://isocpp.org/' },
    { class: 'devicon-docker-plain colored', url: 'https://www.docker.com/' },
    { class: 'devicon-mysql-plain colored', url: 'https://www.mysql.com/' },
    { class: 'devicon-javascript-plain colored', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript' },
    { class: 'devicon-django-plain colored', url: 'https://www.djangoproject.com/' },
    { class: 'devicon-fastapi-plain colored', url: 'https://fastapi.tiangolo.com/' },
    { class: 'devicon-azure-plain colored', url: 'https://azure.microsoft.com/' },
    { class: 'devicon-jupyter-plain colored', url: 'https://jupyter.org/' },
    { class: 'devicon-css3-plain colored', url: 'https://developer.mozilla.org/en-US/docs/Web/CSS' },
    { class: 'devicon-git-plain colored', url: 'https://git-scm.com/' },
    { class: 'devicon-linux-plain colored', url: 'https://www.linux.org/' },
    { class: 'devicon-bash-plain colored', url: 'https://www.gnu.org/software/bash/' },
    { class: 'devicon-ubuntu-plain colored', url: 'https://ubuntu.com/' },
    { class: 'devicon-github-original colored', url: 'https://github.com/' },
    { class: 'devicon-vscode-plain colored', url: 'https://code.visualstudio.com/' },
    { class: 'devicon-markdown-original colored', url: 'https://www.markdownguide.org/' },
    { class: 'devicon-sqlite-plain colored', url: 'https://www.sqlite.org/' },
    { class: 'devicon-firebase-plain colored', url: 'https://firebase.google.com/' },
    { class: 'devicon-mongodb-plain colored', url: 'https://www.mongodb.com/' },
    { class: 'devicon-postgresql-plain colored', url: 'https://www.postgresql.org/' }
  ];
  
  if (marqueeTrack) {
    // Duplicate array to ensure it's extremely long for scrolling
    const FULL_SKILLS = [...SKILLS_DATA, ...SKILLS_DATA];
    
    for (let i = 0; i < FULL_SKILLS.length; i++) {
      const icon = document.createElement('a');
      icon.className = 'marquee-icon';
      icon.href = FULL_SKILLS[i].url;
      icon.target = '_blank';
      icon.rel = 'noopener noreferrer';
      icon.innerHTML = `<i class="${FULL_SKILLS[i].class}"></i>`;
      marqueeTrack.appendChild(icon);
    }

    const icons = document.querySelectorAll('.marquee-icon');
    let scrollPos = 0;
    
    window.addEventListener('scroll', () => {
      scrollPos = window.scrollY;
    });

    function animateMarquee(time) {
      // Horizontal movement tied to scroll
      const scrollX = -(scrollPos * 0.5);
      marqueeTrack.style.transform = `translateX(${scrollX}px)`;

      // Wavy Y-axis animation for each icon (slower, tighter height)
      icons.forEach((icon, index) => {
        const y = Math.sin(time * 0.0012 + index * 0.5) * 35;
        icon.style.transform = `translateY(${y}px)`;
      });

      requestAnimationFrame(animateMarquee);
    }
    requestAnimationFrame(animateMarquee);
  }

  /* =========================================================================
     5. Main Particle Canvas (Ambient Gradient Orbs)
     ========================================================================= */
  const mainCanvas = document.getElementById('particleCanvas');
  let targetMouseX = 0, targetMouseY = 0;
  let currentMouseX = 0, currentMouseY = 0;
  
  window.addEventListener('mousemove', (e) => {
    targetMouseX = (e.clientX - window.innerWidth / 2) * 0.15;
    targetMouseY = (e.clientY - window.innerHeight / 2) * 0.15;
  });

  if (mainCanvas) {
    const ctx = mainCanvas.getContext('2d');
    let width, height;
    
    function resizeMain() {
      width = mainCanvas.width = window.innerWidth;
      height = mainCanvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resizeMain);
    resizeMain();

    // Apply intense CSS blur and scale up to hide blurred edges
    mainCanvas.style.filter = 'blur(100px)';
    mainCanvas.style.transform = 'scale(1.2)';
    mainCanvas.style.opacity = '0.2';

    const orbs = [
      { x: width * 0.2, y: height * 0.3, vx: 0.5, vy: 0.3, size: 400, color: '#4285f4' }, // Blue
      { x: width * 0.8, y: height * 0.7, vx: -0.4, vy: 0.5, size: 500, color: '#a855f7' }, // Purple
      { x: width * 0.5, y: height * 0.5, vx: 0.6, vy: -0.4, size: 350, color: '#22c55e' }, // Green
      { x: width * 0.2, y: height * 0.8, vx: 0.3, vy: -0.6, size: 450, color: '#f59e0b' }  // Amber
    ];

    function drawMainCanvas() {
      ctx.clearRect(0, 0, width, height);
      currentMouseX += (targetMouseX - currentMouseX) * 0.05;
      currentMouseY += (targetMouseY - currentMouseY) * 0.05;
      
      for(let i = 0; i < orbs.length; i++) {
        const orb = orbs[i];
        
        // Drift
        orb.x += orb.vx;
        orb.y += orb.vy;
        
        // Bounce off invisible walls
        if (orb.x < -orb.size || orb.x > width + orb.size) orb.vx *= -1;
        if (orb.y < -orb.size || orb.y > height + orb.size) orb.vy *= -1;
        
        // Deep Parallax effect
        const drawX = orb.x - currentMouseX * (i * 0.5 + 1);
        const drawY = orb.y - currentMouseY * (i * 0.5 + 1);
        
        ctx.fillStyle = orb.color;
        ctx.beginPath();
        ctx.arc(drawX, drawY, orb.size, 0, Math.PI * 2);
        ctx.fill();
      }
      
      requestAnimationFrame(drawMainCanvas);
    }
    drawMainCanvas();
  }

  /* =========================================================================
     7. Continuous Projects Canvas & Navigation
     ========================================================================= */
  const pCanvas = document.getElementById('projectsCanvas');
  const scrollContainer = document.querySelector('.projects-scroll-container');
  if (pCanvas && scrollContainer) {
    const pCtx = pCanvas.getContext('2d');
    let cw, ch;
    let particles = [];
    
    // Parallax tracking
    let targetMouseX = 0;
    let targetMouseY = 0;
    let currentMouseX = 0;
    let currentMouseY = 0;

    const section = pCanvas.parentElement;
    section.addEventListener('mousemove', (e) => {
      const rect = section.getBoundingClientRect();
      // Calculate mouse offset from center of section (-1 to 1)
      targetMouseX = ((e.clientX - rect.left) / section.offsetWidth - 0.5) * 2;
      targetMouseY = ((e.clientY - rect.top) / section.offsetHeight - 0.5) * 2;
    });
    section.addEventListener('mouseleave', () => {
      targetMouseX = 0;
      targetMouseY = 0;
    });


    
    function initProjectsCanvas() {
      cw = window.innerWidth;
      ch = scrollContainer.offsetHeight; 
      pCanvas.width = cw;
      pCanvas.height = ch;
      
      const virtualWidth = scrollContainer.scrollWidth || cw * 5; 
      
      particles = [];
      const numParticles = 250; // Reduced quantity
      for(let i=0; i<numParticles; i++) {
        particles.push({
          x: Math.random() * virtualWidth,
          y: Math.random() * ch,
          speed: Math.random() * 0.015 + 0.005, // Much slower
          size: Math.random() * 2 + 1,
          baseY: Math.random() * ch,
          wobbleSpeed: Math.random() * 0.0005 + 0.0001, // Much slower wobble
          wobbleDistance: Math.random() * 80 + 20,
          parallaxDepth: Math.random() * 40 + 10 
        });
      }
    }

    window.addEventListener('resize', () => {
      clearTimeout(window.pResizeTimer);
      window.pResizeTimer = setTimeout(initProjectsCanvas, 200);
    });
    
    initProjectsCanvas();
    setTimeout(initProjectsCanvas, 500);

    function drawProjects() {
      pCtx.clearRect(0, 0, cw, ch);
      
      // Smooth out mouse movement
      currentMouseX += (targetMouseX - currentMouseX) * 0.05;
      currentMouseY += (targetMouseY - currentMouseY) * 0.05;

      const virtualWidth = scrollContainer.scrollWidth || cw * 5;
      const scrollOffset = scrollContainer.scrollLeft;
      
      pCtx.globalAlpha = 0.5; // Faded look
      
      for(let p of particles) {
        p.x += p.speed;
        if (p.x > virtualWidth + 50) {
          p.x = -50;
          p.baseY = Math.random() * ch;
        }
        
        p.y = p.baseY + Math.sin(Date.now() * p.wobbleSpeed + p.x) * p.wobbleDistance;
        
        // Add parallax based on depth
        const parallaxX = currentMouseX * p.parallaxDepth;
        const parallaxY = currentMouseY * p.parallaxDepth;

        const screenX = (p.x - scrollOffset) - parallaxX;
        const screenY = p.y - parallaxY;
        
        if (screenX > -20 && screenX < cw + 20 && screenY > -20 && screenY < ch + 20) {
          const progress = p.x / virtualWidth;
          let color = '#4285f4'; 
          
          if (progress < 0.2) color = lerpColor('#4285f4', '#34a853', progress / 0.2);
          else if (progress < 0.4) color = lerpColor('#34a853', '#fbbc04', (progress-0.2) / 0.2);
          else if (progress < 0.6) color = lerpColor('#fbbc04', '#ea4335', (progress-0.4) / 0.2);
          else if (progress < 0.8) color = lerpColor('#ea4335', '#a142f4', (progress-0.6) / 0.2);
          else color = lerpColor('#a142f4', '#4285f4', (progress-0.8) / 0.2);
          
          const hexToRgba = (hex, alpha) => {
             const r = parseInt(hex.slice(1, 3), 16);
             const g = parseInt(hex.slice(3, 5), 16);
             const b = parseInt(hex.slice(5, 7), 16);
             return `rgba(${r}, ${g}, ${b}, ${alpha})`;
          };

          // Draw the dot as a soft gradient
          const grad = pCtx.createRadialGradient(screenX, screenY, 0, screenX, screenY, p.size * 2);
          grad.addColorStop(0, hexToRgba(color, 1));
          grad.addColorStop(1, hexToRgba(color, 0));
          
          pCtx.beginPath();
          pCtx.arc(screenX, screenY, p.size * 2, 0, Math.PI*2);
          pCtx.fillStyle = grad;
          pCtx.fill();
        }
      }
      requestAnimationFrame(drawProjects);
    }
    drawProjects();
    
    function lerpColor(a, b, amount) {
        const ah = parseInt(a.replace(/#/g, ''), 16),
            ar = ah >> 16, ag = ah >> 8 & 0xff, ab = ah & 0xff,
            bh = parseInt(b.replace(/#/g, ''), 16),
            br = bh >> 16, bg = bh >> 8 & 0xff, bb = bh & 0xff,
            rr = ar + amount * (br - ar),
            rg = ag + amount * (bg - ag),
            rb = ab + amount * (bb - ab);
        return '#' + ((1 << 24) + (rr << 16) + (rg << 8) + rb | 0).toString(16).slice(1);
    }
  }

  // Hackathons Navigation
  const hackPrevBtn = document.getElementById('hackPrevBtn');
  const hackNextBtn = document.getElementById('hackNextBtn');
  const hackScrollContainer = document.querySelector('.hackathons-grid');
  
  if (hackPrevBtn && hackNextBtn && hackScrollContainer) {
    hackPrevBtn.addEventListener('click', () => {
      const cardWidth = hackScrollContainer.querySelector('.hackathon-card').offsetWidth;
      hackScrollContainer.scrollBy({ left: -(cardWidth + 32), behavior: 'smooth' });
    });
    hackNextBtn.addEventListener('click', () => {
      const cardWidth = hackScrollContainer.querySelector('.hackathon-card').offsetWidth;
      hackScrollContainer.scrollBy({ left: (cardWidth + 32), behavior: 'smooth' });
    });
  }

  // Image Modal Logic
  const imageModal = document.getElementById("imageModal");
  const modalImage = document.getElementById("modalImage");
  const closeImageModalBtn = document.querySelector(".close-modal");
  const certImages = document.querySelectorAll('.hackathon-img-wrapper img, .cp-img-wrapper img');
  
  if (imageModal && modalImage) {
    certImages.forEach(img => {
      img.parentElement.addEventListener('click', function() {
        imageModal.style.display = "flex";
        // small timeout to allow display flex to apply before opacity transition
        setTimeout(() => {
          imageModal.classList.add('show');
        }, 10);
        modalImage.src = img.src;
        document.body.style.overflow = 'hidden'; // Prevent scrolling
      });
    });

    const closeImageModal = () => {
      imageModal.classList.remove('show');
      setTimeout(() => {
        imageModal.style.display = "none";
        document.body.style.overflow = 'auto';
      }, 300); // match CSS transition duration
    };

    if (closeImageModalBtn) {
      closeImageModalBtn.addEventListener('click', closeImageModal);
    }

    imageModal.addEventListener('click', function(e) {
      if (e.target !== modalImage) {
        closeImageModal();
      }
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && imageModal.style.display === 'flex') {
        closeImageModal();
      }
    });
  }

  // Timeline Scroll Animation
  const timeline = document.querySelector('.cp-timeline');
  const stepNumbers = document.querySelectorAll('.cp-step-number');

  if (timeline && stepNumbers.length > 0) {
    const updateTimelineScroll = () => {
      const windowHeight = window.innerHeight;
      const triggerPoint = windowHeight * 0.45;
      
      let activeIndex = -1;
      let minDistance = Infinity;

      stepNumbers.forEach((num, index) => {
        const stepCard = num.closest('.cp-step');
        if (stepCard) {
          const rect = stepCard.getBoundingClientRect();
          // Check if trigger point is within this step's bounds or closest to its center
          if (rect.top <= triggerPoint && rect.bottom >= triggerPoint) {
            activeIndex = index;
          } else {
            const distance = Math.abs((rect.top + rect.height / 2) - triggerPoint);
            if (activeIndex === -1 && distance < minDistance) {
              minDistance = distance;
              activeIndex = index;
            }
          }
        }
      });

      stepNumbers.forEach((num, index) => {
        if (index === activeIndex) {
          num.classList.add('active');
        } else {
          num.classList.remove('active');
        }
      });
    };

    window.addEventListener('scroll', () => {
      requestAnimationFrame(updateTimelineScroll);
    }, { passive: true });

    updateTimelineScroll();
  }
});


