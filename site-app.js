(function () {
  var LS_SITE = "bulldomingo_site_data_v1";
  var LS_PROPERTIES = "bulldomingo_properties_v1";
  var MAX_THUMBS = 10;

  var properties = [];
  var currentEditId = null;
  var editingPropertyRef = null;
  var siteOverrides = {};
  var cmsChannel =
    typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("bulldomingo_cms_listings") : null;

  /* ================================================================
     UTILITIES
  ================================================================ */
  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function parsePrice(val) {
    if (typeof val === "number" && !isNaN(val)) return val;
    if (!val) return 0;
    var n = parseInt(String(val).replace(/[^0-9]/g, ""), 10);
    return isNaN(n) ? 0 : n;
  }

  function formatPrice(n) {
    if (n == null || n === "") return "$0";
    var num = typeof n === "number" ? n : parsePrice(n);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    }).format(num);
  }

  var SITE_KEYS = ["hero", "propertiesSection", "about", "whyUs", "contact", "footer"];

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function applySiteSectionOverrides(base, overrides) {
    if (!overrides || typeof overrides !== "object") return;
    SITE_KEYS.forEach(function (k) {
      if (overrides[k] !== undefined) {
        base[k] = clone(overrides[k]);
      }
    });
  }

  function getSiteData() {
    var base = clone(window.BULLDOMINGO_SITE);
    try {
      var raw = localStorage.getItem(LS_SITE);
      if (raw) {
        var parsed = JSON.parse(raw);
        applySiteSectionOverrides(base, parsed);
      }
    } catch (e) {}
    applySiteSectionOverrides(base, siteOverrides);
    return base;
  }

  function migrateListingToProperty(l, idx) {
    var id = idx + 1;
    if (l.type === "photos") {
      return {
        id: id,
        title: l.title || "",
        price: parsePrice(l.price),
        location: l.location || "",
        description: l.description || "",
        images: {
          hero: l.heroImage || null,
          thumbs: (l.thumbImages || []).slice(0, MAX_THUMBS)
        }
      };
    }
    return {
      id: id,
      title: l.title || "",
      price: parsePrice(l.price),
      location: l.location || "",
      description: l.description || "",
      images: { hero: null, thumbs: [] }
    };
  }

  function loadPropertiesFromSite() {
    var site = window.BULLDOMINGO_SITE;
    if (!site || !site.listings) return [];
    return site.listings.map(migrateListingToProperty);
  }

  var IDB_NAME = "bulldomingo_cms_v1";
  var IDB_VER = 1;
  var IDB_STORE = "kv";
  var IDB_KEY_LISTINGS = "listings";
  var IDB_KEY_SITE = "site_content";

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      var req = indexedDB.open(IDB_NAME, IDB_VER);
      req.onerror = function () {
        reject(req.error);
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
    });
  }

  function idbGetKey(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var result = null;
        var tx = db.transaction(IDB_STORE, "readonly");
        tx.oncomplete = function () {
          db.close();
          resolve(result);
        };
        tx.onerror = function () {
          db.close();
          reject(tx.error);
        };
        var r = tx.objectStore(IDB_STORE).get(key);
        r.onsuccess = function () {
          result = r.result === undefined ? null : r.result;
        };
      });
    });
  }

  function idbPutKey(key, value) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.oncomplete = function () {
          db.close();
          resolve();
        };
        tx.onerror = function () {
          db.close();
          reject(tx.error);
        };
        tx.objectStore(IDB_STORE).put(value, key);
      });
    });
  }

  function idbGetListingsJson() {
    return idbGetKey(IDB_KEY_LISTINGS);
  }

  function idbPutListingsJson(jsonString) {
    return idbPutKey(IDB_KEY_LISTINGS, jsonString);
  }

  function loadSiteOverridesAsync() {
    return idbGetKey(IDB_KEY_SITE)
      .then(function (raw) {
        if (raw) {
          try {
            var o = JSON.parse(raw);
            if (o && typeof o === "object") {
              siteOverrides = o;
            } else {
              siteOverrides = {};
            }
          } catch (e) {
            siteOverrides = {};
          }
        } else {
          siteOverrides = {};
        }
        tryMigrateLsSiteToSiteOverrides();
        return siteOverrides;
      })
      .catch(function () {
        siteOverrides = {};
        tryMigrateLsSiteToSiteOverrides();
        return siteOverrides;
      });
  }

  function tryMigrateLsSiteToSiteOverrides() {
    try {
      var raw = localStorage.getItem(LS_SITE);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      SITE_KEYS.forEach(function (k) {
        if (parsed[k] !== undefined) {
          siteOverrides[k] = clone(parsed[k]);
        }
      });
      localStorage.removeItem(LS_SITE);
      return idbPutKey(IDB_KEY_SITE, JSON.stringify(siteOverrides));
    } catch (e) {}
  }

  function saveSiteOverrides() {
    return idbPutKey(IDB_KEY_SITE, JSON.stringify(siteOverrides))
      .then(function () {
        broadcastSiteUpdated();
        return true;
      })
      .catch(function (e) {
        console.warn("Bulldomingo: could not save page content.", e);
        alert("Could not save page content. Try freeing disk space.");
        return false;
      });
  }

  function broadcastSiteUpdated() {
    if (cmsChannel) cmsChannel.postMessage({ t: "site" });
  }

  function refreshPageFromSiteData() {
    var site = getSiteData();
    renderHero(site);
    renderPropertiesHeader(site);
    renderAbout(site);
    renderAboutVisual(site);
    renderWhyUs(site);
    renderContact(site);
    renderFooter(site);
    setupScrollAnimations();
  }

  function migrateFromLocalStorageOrSite() {
    return new Promise(function (resolve) {
      try {
        var ls = localStorage.getItem(LS_PROPERTIES);
        if (ls) {
          var parsed = JSON.parse(ls);
          if (Array.isArray(parsed)) {
            localStorage.removeItem(LS_PROPERTIES);
            idbPutListingsJson(JSON.stringify(parsed))
              .then(function () {
                resolve(parsed);
              })
              .catch(function () {
                resolve(parsed);
              });
            return;
          }
        }
      } catch (e) {}
      resolve(loadPropertiesFromSite());
    });
  }

  function loadPropertiesAsync() {
    return idbGetListingsJson()
      .then(function (raw) {
        if (raw !== null && raw !== undefined) {
          try {
            var parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
          } catch (e) {}
        }
        return migrateFromLocalStorageOrSite();
      })
      .catch(function () {
        return migrateFromLocalStorageOrSite();
      });
  }

  var cmsGridRenderTimer = null;

  function broadcastPropertiesUpdated() {
    if (cmsChannel) cmsChannel.postMessage({ t: "sync" });
  }

  function clearCmsGridRenderTimer() {
    if (cmsGridRenderTimer) {
      clearTimeout(cmsGridRenderTimer);
      cmsGridRenderTimer = null;
    }
  }

  function clearSaveBanner() {
    var b = document.getElementById("cmsSaveBanner");
    if (b) b.remove();
  }

  function showSaveBanner(message) {
    clearSaveBanner();
    var panel = document.querySelector("#cmsEditModal .cms-modal-panel");
    if (!panel) {
      if (message) alert(message);
      return;
    }
    var b = document.createElement("div");
    b.id = "cmsSaveBanner";
    b.className = "cms-save-banner";
    b.setAttribute("role", "alert");
    b.textContent = message;
    panel.insertBefore(b, panel.firstChild);
  }

  function trySavePropertiesLocalStorageFallback(json) {
    return new Promise(function (resolve) {
      try {
        localStorage.setItem(LS_PROPERTIES, json);
        if (localStorage.getItem(LS_PROPERTIES) !== json) {
          showSaveBanner(
            "Could not save. Try refreshing the page. If problems continue, free disk space or remove some images."
          );
          resolve(false);
          return;
        }
        clearSaveBanner();
        broadcastPropertiesUpdated();
        resolve(true);
      } catch (e2) {
        console.warn("Bulldomingo: localStorage fallback failed.", e2);
        var msg =
          e2 && (e2.name === "QuotaExceededError" || e2.code === 22)
            ? "Storage is full. Remove photos from some listings or use smaller image files."
            : "Could not save. Free disk space, remove images, or try another browser.";
        showSaveBanner(msg);
        resolve(false);
      }
    });
  }

  function saveProperties() {
    var json;
    try {
      json = JSON.stringify(properties);
    } catch (e) {
      showSaveBanner("Could not serialize listings.");
      return Promise.resolve(false);
    }
    return idbPutListingsJson(json)
      .then(function () {
        return idbGetListingsJson();
      })
      .then(function (readBack) {
        if (readBack !== json) {
          showSaveBanner("Save did not verify. Try again.");
          return false;
        }
        try {
          localStorage.removeItem(LS_PROPERTIES);
        } catch (rm) {}
        clearSaveBanner();
        broadcastPropertiesUpdated();
        return true;
      })
      .catch(function (e) {
        console.warn("Bulldomingo: IndexedDB save failed; using localStorage fallback.", e);
        return trySavePropertiesLocalStorageFallback(json);
      });
  }

  function compressDataUrl(dataUrl, maxSide, quality, done) {
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth,
        h = img.naturalHeight;
      if (!w || !h) {
        done(dataUrl);
        return;
      }
      if (w <= maxSide && h <= maxSide) {
        done(dataUrl);
        return;
      }
      var scale = maxSide / Math.max(w, h);
      var nw = Math.max(1, Math.round(w * scale));
      var nh = Math.max(1, Math.round(h * scale));
      var canvas = document.createElement("canvas");
      canvas.width = nw;
      canvas.height = nh;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, nw, nh);
      try {
        done(canvas.toDataURL("image/jpeg", quality));
      } catch (e) {
        done(dataUrl);
      }
    };
    img.onerror = function () {
      done(dataUrl);
    };
    img.src = dataUrl;
  }

  function setupStorageSync() {
    if (cmsChannel) {
      cmsChannel.onmessage = function (ev) {
        var d = ev && ev.data;
        if (d && d.t === "site") {
          idbGetKey(IDB_KEY_SITE).then(function (raw) {
            if (!raw) return;
            try {
              siteOverrides = JSON.parse(raw);
              refreshPageFromSiteData();
            } catch (e) {}
          });
          return;
        }
        idbGetListingsJson().then(function (raw) {
          if (raw == null) return;
          try {
            var parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return;
            properties = parsed;
            renderProperties();
            setupScrollAnimations();
          } catch (e) {}
        });
      };
    }
    window.addEventListener("storage", function (e) {
      if (e.key !== LS_PROPERTIES || e.newValue == null) return;
      try {
        var parsed = JSON.parse(e.newValue);
        if (!Array.isArray(parsed)) return;
        properties = parsed;
        renderProperties();
        setupScrollAnimations();
      } catch (err) {}
    });
  }

  var PIN_SVG =
    '<svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>';

  function themeClassForId(id) {
    var themes = ["meadow", "desert", "mountain", "forest", "plains", "lakefront"];
    return themes[(Number(id) || 0) % themes.length];
  }

  /* ================================================================
     RENDER LISTINGS (cards)
  ================================================================ */
  function renderDetailLine(d) {
    var rest = d.rest ? "&nbsp;" + escapeHtml(d.rest) : "";
    return '<div class="card-detail"><strong>' + escapeHtml(d.strong) + "</strong>" + rest + "</div>";
  }

  function propertyToLegacyListing(p) {
    var imgs = p.images || { hero: null, thumbs: [] };
    var hero = imgs.hero;
    var thumbs = imgs.thumbs || [];
    if (hero) {
      return {
        type: "photos",
        badge: "New Listing",
        badgeClass: "",
        location: p.location,
        title: p.title,
        description: p.description,
        heroImage: hero,
        heroAlt: p.title,
        thumbImages: thumbs,
        details: [],
        price: formatPrice(p.price),
        pricePerAcre: ""
      };
    }
    return {
      type: "theme",
      theme: themeClassForId(p.id),
      emoji: "🌾",
      badge: "New Listing",
      badgeClass: "",
      location: p.location,
      title: p.title,
      description: p.description,
      details: [],
      price: formatPrice(p.price),
      pricePerAcre: ""
    };
  }

  function renderPropertyCard(p, idx) {
    var listing = propertyToLegacyListing(p);
    var badgeClass = listing.badgeClass ? " " + escapeHtml(listing.badgeClass) : "";
    var detailsHtml = (listing.details || []).map(renderDetailLine).join("");
    var desc = listing.description
      ? '<p class="card-desc">' + escapeHtml(listing.description) + "</p>"
      : "";
    var dataAttr = ' data-property-id="' + p.id + '" data-listing-idx="' + idx + '"';

    if (listing.type === "photos") {
      var thumbs = (listing.thumbImages || [])
        .map(function (src) {
          return '<img src="' + escapeHtml(src) + '" alt="">';
        })
        .join("");
      return (
        '<div class="property-card"' +
        dataAttr +
        ">" +
        '<div class="card-image card-image--listing">' +
        '<img class="card-hero-img" src="' +
        escapeHtml(listing.heroImage) +
        '" alt="' +
        escapeHtml(listing.heroAlt || listing.title) +
        '">' +
        '<div class="card-photo-thumbs" aria-hidden="true">' +
        thumbs +
        "</div>" +
        '<div class="card-badge' +
        badgeClass +
        '">' +
        escapeHtml(listing.badge) +
        "</div>" +
        "</div>" +
        '<div class="card-body">' +
        '<div class="card-location">' +
        PIN_SVG +
        escapeHtml(listing.location) +
        "</div>" +
        '<div class="card-title">' +
        escapeHtml(listing.title) +
        "</div>" +
        desc +
        '<div class="card-details">' +
        detailsHtml +
        "</div>" +
        '<div class="card-price">' +
        escapeHtml(listing.price) +
        "</div>" +
        "</div></div>"
      );
    }

    return (
      '<div class="property-card"' +
      dataAttr +
      ">" +
      '<div class="card-image">' +
      '<div class="card-image-bg ' +
      escapeHtml(listing.theme) +
      '">' +
      (listing.emoji || "") +
      "</div>" +
      '<div class="card-badge' +
      badgeClass +
      '">' +
      escapeHtml(listing.badge) +
      "</div>" +
      "</div>" +
      '<div class="card-body">' +
      '<div class="card-location">' +
      PIN_SVG +
      escapeHtml(listing.location) +
      "</div>" +
      '<div class="card-title">' +
      escapeHtml(listing.title) +
      "</div>" +
      desc +
      '<div class="card-details">' +
      detailsHtml +
      "</div>" +
      '<div class="card-price">' +
      escapeHtml(listing.price) +
      "</div>" +
      "</div></div>"
    );
  }

  function renderProperties() {
    var el = document.getElementById("propertiesGrid");
    if (!el) return;
    el.innerHTML = properties.map(renderPropertyCard).join("");
    setupScrollAnimations();
  }

  /* ================================================================
     PAGE SECTION RENDERS
  ================================================================ */
  function renderHero(site) {
    var el = document.getElementById("heroRoot");
    if (!el || !site.hero) return;
    el.innerHTML =
      '<div class="hero-badge">' +
      escapeHtml(site.hero.badge) +
      "</div>" +
      "<h1>" +
      escapeHtml(site.hero.titleMain) +
      "<span>" +
      escapeHtml(site.hero.titleSpan) +
      "</span></h1>" +
      '<p class="hero-sub">' +
      escapeHtml(site.hero.subtitle) +
      "</p>" +
      '<div class="hero-cta">' +
      '<a href="#properties" class="btn btn-primary">Browse Properties</a>' +
      '<a href="#contact" class="btn btn-outline">Get In Touch</a>' +
      "</div>";
  }

  function renderPropertiesHeader(site) {
    var el = document.getElementById("propertiesHeader");
    if (!el || !site.propertiesSection) return;
    var p = site.propertiesSection;
    el.innerHTML =
      '<div class="section-label">' +
      escapeHtml(p.sectionLabel) +
      "</div>" +
      '<h2 class="section-title">' +
      escapeHtml(p.title) +
      "</h2>" +
      '<p class="section-subtitle">' +
      escapeHtml(p.subtitle) +
      "</p>";
  }

  function renderAbout(site) {
    var el = document.getElementById("aboutRoot");
    if (!el || !site.about) return;
    var a = site.about;
    var paras = (a.paragraphs || [])
      .map(function (p) {
        return "<p>" + escapeHtml(p) + "</p>";
      })
      .join("");
    var stats = (a.stats || [])
      .map(function (s) {
        return (
          '<div class="stat-item"><div class="stat-number">' +
          escapeHtml(s.number) +
          '</div><div class="stat-label">' +
          escapeHtml(s.label) +
          "</div></div>"
        );
      })
      .join("");
    el.innerHTML =
      '<div class="section-label">' +
      escapeHtml(a.sectionLabel) +
      "</div>" +
      '<h2 class="section-title">' +
      escapeHtml(a.title) +
      "</h2>" +
      paras +
      '<div class="about-stats">' +
      stats +
      "</div>";
  }

  function renderAboutVisual(site) {
    var el = document.getElementById("aboutVisual");
    if (!el || !site.about) return;
    var a = site.about;
    var img = a.image;
    if (img && String(img).trim()) {
      el.innerHTML =
        '<img class="about-visual-img" src="' + escapeHtml(img) + '" alt="">';
    } else {
      el.innerHTML =
        '<div class="about-icon">' +
        escapeHtml(a.emoji != null && a.emoji !== "" ? a.emoji : "\u26F0\uFE0F") +
        "</div>";
    }
  }

  function renderWhyUs(site) {
    var el = document.getElementById("whyUsRoot");
    if (!el || !site.whyUs) return;
    var w = site.whyUs;
    var items = (w.items || [])
      .map(function (it) {
        return (
          '<div class="why-item"><div class="why-icon">' +
          escapeHtml(it.icon) +
          '</div><div class="why-title">' +
          escapeHtml(it.title) +
          '</div><div class="why-desc">' +
          escapeHtml(it.desc) +
          "</div></div>"
        );
      })
      .join("");
    el.innerHTML =
      '<div class="section-label" style="text-align:center">' +
      escapeHtml(w.sectionLabel) +
      "</div>" +
      '<h2 class="section-title" style="text-align:center">' +
      escapeHtml(w.title) +
      "</h2>" +
      '<div class="why-grid">' +
      items +
      "</div>";
  }

  function renderContact(site) {
    var el = document.getElementById("contactInfoRoot");
    if (!el || !site.contact) return;
    var c = site.contact,
      email = escapeHtml(c.salesEmail);
    el.innerHTML =
      '<div class="section-label">' +
      escapeHtml(c.sectionLabel) +
      "</div>" +
      '<h2 class="section-title">' +
      escapeHtml(c.title) +
      "</h2>" +
      '<p class="section-subtitle">' +
      escapeHtml(c.subtitle) +
      "</p>" +
      '<div class="contact-method"><div class="contact-method-icon">' +
      '<svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>' +
      '<polyline points="22,6 12,13 2,6"/></svg></div>' +
      '<div><div class="contact-method-label">Email</div>' +
      '<div class="contact-method-value"><a href="mailto:' +
      email +
      '">' +
      email +
      "</a></div></div></div>";
  }

  function renderFooter(site) {
    var el = document.getElementById("footerCopy");
    if (!el || !site.footer) return;
    el.textContent = site.footer.copy.replace(/©/g, "\u00A9");
  }

  /* ================================================================
     SCROLL ANIMATIONS
  ================================================================ */
  function setupScrollAnimations() {
    var inEdit = document.body.classList.contains("edit-mode-active");
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.style.opacity = "1";
            entry.target.style.transform = "translateY(0)";
          }
        });
      },
      { threshold: 0.1 }
    );

    document.querySelectorAll(".property-card, .why-item, .stat-item").forEach(function (el) {
      el.style.transition = "opacity 0.6s ease, transform 0.6s ease";
      if (inEdit) {
        el.style.opacity = "1";
        el.style.transform = "translateY(0)";
      } else {
        el.style.opacity = "0";
        el.style.transform = "translateY(30px)";
        observer.observe(el);
      }
    });
  }

  /* ================================================================
     CONTACT FORM
  ================================================================ */
  function setupContactForm(site) {
    var form = document.getElementById("contactForm");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var sd = getSiteData();
      var salesEmail = (sd.contact && sd.contact.salesEmail) || "sales@bulldomingo.com";
      var fn = String(((document.getElementById("firstName") || {}).value || "")).trim();
      var ln = String(((document.getElementById("lastName") || {}).value || "")).trim();
      var em = String(((document.getElementById("email") || {}).value || "")).trim();
      var ii = String(((document.getElementById("interestedIn") || {}).value || "")).trim();
      var ms = String(((document.getElementById("message") || {}).value || "")).trim();
      if (!fn || !ln || !em || !ii || !ms) return;
      var subject = "Website inquiry: " + ii + " (" + fn + " " + ln + ")";
      var body = [
        "New inquiry from Bulldomingo website",
        "",
        "First name: " + fn,
        "Last name: " + ln,
        "Email: " + em,
        "Interested in: " + ii,
        "",
        "Message:",
        ms
      ].join("\n");
      window.location.href =
        "mailto:" +
        salesEmail +
        "?subject=" +
        encodeURIComponent(subject) +
        "&body=" +
        encodeURIComponent(body);
    });
  }

  function setupSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
      anchor.addEventListener("click", function (e) {
        var href = this.getAttribute("href");
        if (!href || href === "#") return;
        var target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: "smooth", block: "start" });
          var nav = document.getElementById("navLinks");
          if (nav) nav.classList.remove("open");
        }
      });
    });
  }

  /* ================================================================
     VIEW MODAL (read-only)
  ================================================================ */
  function buildModalLeft(listing) {
    if (listing.type === "photos" && listing.heroImage) {
      var allImgs = [listing.heroImage].concat(listing.thumbImages || []);
      var thumbsHtml = allImgs
        .map(function (src, i) {
          return (
            '<img class="modal-thumb' +
            (i === 0 ? " active" : "") +
            '" src="' +
            escapeHtml(src) +
            '" data-src="' +
            escapeHtml(src) +
            '" alt="">'
          );
        })
        .join("");
      return (
        '<div class="modal-hero-wrap">' +
        '<img class="modal-hero-img" id="mHeroImg" src="' +
        escapeHtml(listing.heroImage) +
        '" alt="' +
        escapeHtml(listing.title) +
        '">' +
        "</div>" +
        (allImgs.length > 1
          ? '<div class="modal-gallery-bar" id="mGallery">' + thumbsHtml + "</div>"
          : "")
      );
    }
    var themeClass = escapeHtml(listing.theme || "meadow");
    return (
      '<div class="modal-hero-wrap">' +
      '<div class="modal-theme-hero card-image-bg ' +
      themeClass +
      '">' +
      (listing.emoji || "") +
      "</div>" +
      "</div>"
    );
  }

  function buildModalRight(listing) {
    var badgeExtra = listing.badgeClass === "sold" ? " sold" : "";
    var detailTiles = (listing.details || [])
      .map(function (d) {
        return (
          '<div class="modal-detail-tile">' +
          '<div class="modal-detail-val">' +
          escapeHtml(d.strong) +
          "</div>" +
          '<div class="modal-detail-lbl">' +
          escapeHtml(d.rest) +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    var priceAcreHtml = listing.pricePerAcre
      ? '<span class="modal-price-acre">/ ' + escapeHtml(listing.pricePerAcre) + "</span>"
      : "";

    return (
      "<div>" +
      '<div class="modal-badge-line">' +
      '<span class="modal-badge' +
      badgeExtra +
      '">' +
      escapeHtml(listing.badge) +
      "</span>" +
      '<span class="modal-type-pill">' +
      (listing.type === "photos" ? "Photos" : escapeHtml(listing.theme || "")) +
      "</span>" +
      "</div>" +
      '<div class="modal-location">' +
      PIN_SVG +
      escapeHtml(listing.location) +
      "</div>" +
      '<div class="modal-title">' +
      escapeHtml(listing.title) +
      "</div>" +
      '<div class="modal-price">' +
      escapeHtml(listing.price) +
      priceAcreHtml +
      "</div>" +
      "</div>" +
      (detailTiles
        ? '<div class="modal-hr"></div><div class="modal-details-grid">' + detailTiles + "</div>"
        : "") +
      (listing.description
        ? '<div class="modal-hr"></div><p class="modal-desc">' + escapeHtml(listing.description) + "</p>"
        : "") +
      '<div class="modal-hr"></div>' +
      '<div class="modal-cta">' +
      '<button class="modal-btn-inquire" id="mInquireBtn">Inquire About This Property</button>' +
      '<button class="modal-btn-copy" id="mCopyBtn">Copy Listing Details</button>' +
      "</div>"
    );
  }

  function openViewModal(listing) {
    var content = document.getElementById("modalContent");
    if (!content) return;
    content.innerHTML =
      '<div class="modal-left">' +
      buildModalLeft(listing) +
      "</div>" +
      '<div class="modal-right">' +
      buildModalRight(listing) +
      "</div>";

    wireGallery();
    wireCTA(listing);

    var overlay = document.getElementById("listingModal");
    overlay.setAttribute("aria-hidden", "false");
    overlay.classList.add("modal-open");
    document.body.style.overflow = "hidden";
    setTimeout(function () {
      var cb = document.getElementById("modalClose");
      if (cb) cb.focus();
    }, 60);
  }

  function closeViewModal() {
    var overlay = document.getElementById("listingModal");
    if (!overlay) return;
    overlay.classList.remove("modal-open");
    overlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function wireGallery() {
    var heroImg = document.getElementById("mHeroImg");
    if (!heroImg) return;
    document.querySelectorAll(".modal-thumb").forEach(function (thumb) {
      thumb.onclick = function () {
        heroImg.style.opacity = "0";
        var src = this.getAttribute("data-src");
        setTimeout(function () {
          heroImg.src = src;
          heroImg.style.opacity = "1";
        }, 220);
        document.querySelectorAll(".modal-thumb").forEach(function (t) {
          t.classList.remove("active");
        });
        thumb.classList.add("active");
      };
    });
  }

  function wireCTA(listing) {
    var inquireBtn = document.getElementById("mInquireBtn");
    if (inquireBtn) {
      inquireBtn.onclick = function () {
        closeViewModal();
        var contactSec = document.getElementById("contact");
        if (contactSec) {
          setTimeout(function () {
            contactSec.scrollIntoView({ behavior: "smooth", block: "start" });
            var msgEl = document.getElementById("message");
            if (msgEl && !msgEl.value.trim()) {
              msgEl.value =
                "I\u2019m interested in the " +
                (listing.title || "listing") +
                " (" +
                (listing.location || "") +
                ") listed at " +
                (listing.price || "") +
                ". Please send me more information.";
            }
          }, 380);
        }
      };
    }

    var copyBtn = document.getElementById("mCopyBtn");
    if (copyBtn) {
      copyBtn.onclick = function () {
        var lines = [
          listing.title,
          listing.location,
          listing.price ? "Price: " + listing.price : "",
          listing.pricePerAcre || "",
          listing.description || ""
        ]
          .filter(Boolean)
          .join("\n");

        function showCopied() {
          copyBtn.textContent = "Copied!";
          setTimeout(function () {
            copyBtn.textContent = "Copy Listing Details";
          }, 2000);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(lines).then(showCopied).catch(function () {});
        } else {
          var ta = document.createElement("textarea");
          ta.value = lines;
          ta.style.cssText = "position:fixed;opacity:0";
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand("copy");
            showCopied();
          } catch (e) {}
          document.body.removeChild(ta);
        }
      };
    }
  }

  function setupViewModalEvents() {
    var closeBtn = document.getElementById("modalClose");
    if (closeBtn) closeBtn.onclick = closeViewModal;

    var overlay = document.getElementById("listingModal");
    if (overlay) {
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) closeViewModal();
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var psec = document.getElementById("pageSectionModal");
      if (psec && psec.classList.contains("cms-modal-open")) {
        closePageSectionModal();
        return;
      }
      var cms = document.getElementById("cmsEditModal");
      if (cms && cms.classList.contains("cms-modal-open")) {
        closeModal();
        return;
      }
      var ov = document.getElementById("listingModal");
      if (ov && ov.classList.contains("modal-open")) closeViewModal();
    });
  }

  function getPropertyById(id) {
    for (var i = 0; i < properties.length; i++) {
      if (properties[i].id === id) return properties[i];
    }
    return null;
  }

  function setupCardClickHandlers() {
    var grid = document.getElementById("propertiesGrid");
    if (!grid) return;
    grid.addEventListener("click", function (e) {
      var card = e.target.closest(".property-card");
      if (!card) return;
      var id = parseInt(card.getAttribute("data-property-id"), 10);
      if (isNaN(id)) return;
      var p = getPropertyById(id);
      if (!p) return;

      if (document.body.classList.contains("edit-mode-active")) {
        e.preventDefault();
        openModal(p);
        return;
      }
      openViewModal(propertyToLegacyListing(p));
    });
  }

  /* ================================================================
     EDIT MODE & CMS MODAL
  ================================================================ */
  function isEditMode() {
    var params = new URLSearchParams(window.location.search);
    return params.get("edit") === "1" || params.get("edit") === "true";
  }

  function injectCmsStyles() {
    if (document.getElementById("cmsEditStyles")) return;
    var s = document.createElement("style");
    s.id = "cmsEditStyles";
    s.textContent =
      ".edit-mode-toolbar{text-align:center;margin-bottom:1.5rem;}" +
      ".edit-mode-toolbar .btn{cursor:pointer;}" +
      "body.edit-mode-active .property-card{cursor:pointer;}" +
      "#cmsEditModal,#pageSectionModal{position:fixed;inset:0;z-index:100001;background:rgba(44,24,16,0.88);" +
      "display:flex;align-items:center;justify-content:center;padding:1rem;opacity:0;visibility:hidden;" +
      "transition:opacity 0.25s ease,visibility 0.25s ease;}" +
      "#cmsEditModal.cms-modal-open,#pageSectionModal.cms-modal-open{opacity:1;visibility:visible;}" +
      "#pageSectionModal{z-index:100002;}" +
      ".cms-modal-panel{background:var(--cream,#FAF6EE);width:100%;max-width:560px;max-height:min(92vh,920px);" +
      "border-radius:12px;overflow:hidden;display:flex;flex-direction:column;min-height:0;" +
      "box-shadow:0 24px 60px rgba(0,0,0,0.35);border:2px solid var(--rawhide,#A67C52);}" +
      "#cmsEditInner,#pageSectionInner{display:flex;flex-direction:column;min-height:0;flex:1;overflow:hidden;max-height:100%;}" +
      "#cmsEditModal .cms-modal-head,#pageSectionModal .cms-modal-head{flex-shrink:0;}" +
      "#cmsEditModal .cms-modal-body,#pageSectionModal .cms-modal-body{flex:1 1 auto;min-height:0;overflow-y:auto;" +
      "-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:1.1rem 1.15rem 1.25rem;}" +
      "#pageSectionModal .pe-save-row{position:sticky;bottom:-1px;z-index:3;margin-top:1.25rem;margin-bottom:-0.25rem;" +
      "padding-top:1rem;padding-bottom:0.5rem;background:linear-gradient(180deg,rgba(250,246,238,0),#FAF6EE 22%);}" +
      "#cmsEditModal .cms-modal-body .pe-save-row{position:sticky;bottom:-1px;z-index:3;margin-top:1.25rem;" +
      "padding-top:1rem;padding-bottom:0.5rem;background:linear-gradient(180deg,rgba(250,246,238,0),#FAF6EE 22%);}" +
      "#cmsEditModal .cms-modal-body .cms-actions-row{position:sticky;bottom:-1px;z-index:3;margin-top:1rem;" +
      "padding-top:0.85rem;padding-bottom:0.35rem;background:linear-gradient(180deg,rgba(250,246,238,0),#FAF6EE 25%);}" +
      ".cms-modal-head{display:flex;align-items:center;justify-content:space-between;" +
      "padding:0.85rem 1rem;background:#2C1810;color:#D4B483;font-size:0.85rem;font-weight:700;letter-spacing:1px;}" +
      ".cms-modal-close{background:none;border:none;color:#D4B483;font-size:1.5rem;cursor:pointer;line-height:1;padding:0.2rem;}" +
      ".cms-modal-close:hover{color:#fff;}" +
      ".cms-modal-body{padding:1.1rem 1.15rem 1.25rem;}" +
      ".cms-field{margin-bottom:0.85rem;}" +
      ".cms-label{display:block;font-size:0.65rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;" +
      "color:#5C3A1E;margin-bottom:0.3rem;}" +
      ".cms-input,.cms-textarea{width:100%;padding:0.55rem 0.65rem;border:1px solid rgba(166,124,82,0.45);" +
      "background:#fff;font-family:'Source Sans 3',sans-serif;font-size:0.9rem;color:#2C1810;" +
      "border-radius:3px;box-sizing:border-box;}" +
      ".cms-textarea{min-height:100px;resize:vertical;}" +
      ".cms-hero-box{border:2px dashed rgba(166,124,82,0.45);border-radius:6px;overflow:hidden;" +
      "background:rgba(166,124,82,0.06);min-height:120px;position:relative;}" +
      ".cms-hero-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;" +
      "min-height:120px;cursor:pointer;color:#A67C52;font-size:0.85rem;gap:0.35rem;}" +
      ".cms-hero-empty:hover{background:rgba(166,124,82,0.12);}" +
      ".cms-hero-img{width:100%;height:140px;object-fit:cover;display:block;}" +
      ".cms-hero-actions{display:flex;gap:0.5rem;padding:0.5rem;background:rgba(44,24,16,0.06);}" +
      ".cms-btn-sm{padding:0.4rem 0.75rem;font-size:0.72rem;font-weight:700;letter-spacing:1px;" +
      "text-transform:uppercase;border-radius:3px;cursor:pointer;border:2px solid rgba(166,124,82,0.5);" +
      "background:transparent;color:#5C3A1E;font-family:'Source Sans 3',sans-serif;}" +
      ".cms-btn-sm:hover{background:rgba(166,124,82,0.12);}" +
      ".cms-btn-danger{border-color:#c06050;color:#a03020;}" +
      ".cms-thumbs-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:0.45rem;margin-top:0.35rem;}" +
      ".cms-thumb-cell{position:relative;aspect-ratio:4/3;border-radius:4px;overflow:hidden;" +
      "border:1px solid rgba(166,124,82,0.3);background:#f0ebe3;}" +
      ".cms-thumb-cell img{width:100%;height:100%;object-fit:cover;display:block;}" +
      ".cms-thumb-rm{position:absolute;top:4px;right:4px;width:22px;height:22px;border:none;border-radius:50%;" +
      "background:rgba(44,24,16,0.82);color:#fff;font-size:12px;line-height:22px;cursor:pointer;padding:0;}" +
      ".cms-thumb-add{display:flex;align-items:center;justify-content:center;cursor:pointer;" +
      "border:2px dashed rgba(166,124,82,0.45);border-radius:4px;min-height:72px;color:#A67C52;" +
      "font-size:1.6rem;background:rgba(166,124,82,0.05);}" +
      ".cms-thumb-add:hover{background:rgba(166,124,82,0.14);}" +
      ".cms-actions-row{display:flex;gap:0.6rem;margin-top:1rem;flex-wrap:wrap;}" +
      ".cms-btn-del{flex:1;min-width:140px;padding:0.65rem;background:transparent;color:#a03020;" +
      "border:2px solid #c06050;font-weight:700;letter-spacing:1px;text-transform:uppercase;" +
      "cursor:pointer;font-family:'Source Sans 3',sans-serif;font-size:0.75rem;border-radius:3px;}" +
      ".cms-btn-del:hover{background:rgba(192,96,80,0.12);}" +
      "#cmsHeroFile,#cmsThumbFile{display:none;}" +
      ".cms-save-banner{background:#8B2E2E;color:#F2E8D5;padding:0.65rem 1rem;font-size:0.82rem;" +
      "line-height:1.45;border-bottom:2px solid #5C1818;flex-shrink:0;}" +
      ".pe-row{display:flex;gap:0.4rem;align-items:center;margin-bottom:0.45rem;}" +
      ".pe-row .cms-input{flex:1;}" +
      ".pe-btn-xs{padding:0.25rem 0.45rem;font-size:0.7rem;cursor:pointer;border:1px solid rgba(166,124,82,0.5);" +
      "background:#fff;border-radius:3px;}" +
      ".pe-save-row{margin-top:1rem;}" +
      ".pe-save-row .btn-primary{width:100%;cursor:pointer;}";
    document.head.appendChild(s);
  }

  function ensureImagesShape(p) {
    if (!p.images) p.images = { hero: null, thumbs: [] };
    if (!Array.isArray(p.images.thumbs)) p.images.thumbs = [];
  }

  function syncEditingRef() {
    if (currentEditId == null) return;
    editingPropertyRef = getPropertyById(currentEditId);
  }

  function flushEditFormToProperty() {
    if (currentEditId == null) return;
    syncEditingRef();
    if (!editingPropertyRef) return;
    var titleEl = document.getElementById("cmsInpTitle");
    var priceEl = document.getElementById("cmsInpPrice");
    var locEl = document.getElementById("cmsInpLoc");
    var descEl = document.getElementById("cmsInpDesc");
    if (titleEl) editingPropertyRef.title = String(titleEl.value || "");
    if (priceEl) editingPropertyRef.price = parseInt(priceEl.value, 10) || 0;
    if (locEl) editingPropertyRef.location = String(locEl.value || "");
    if (descEl) editingPropertyRef.description = String(descEl.value || "");
    ensureImagesShape(editingPropertyRef);
  }

  function buildHeroEditHtml() {
    syncEditingRef();
    if (!editingPropertyRef) return "";
    ensureImagesShape(editingPropertyRef);
    var h = editingPropertyRef.images.hero;
    if (h) {
      return (
        "<div>" +
        '<div class="cms-hero-box">' +
        '<img class="cms-hero-img" id="cmsHeroPreview" src="' +
        escapeHtml(h) +
        '" alt="">' +
        "</div>" +
        '<div class="cms-hero-actions">' +
        '<button type="button" class="cms-btn-sm" id="cmsPickHero">Change</button>' +
        '<button type="button" class="cms-btn-sm cms-btn-danger" id="cmsRemoveHero">Remove</button>' +
        "</div></div>"
      );
    }
    return (
      '<div class="cms-hero-box cms-hero-empty" id="cmsHeroDrop">' +
      "<span>&#128247;</span><span>Click to upload hero image</span></div>"
    );
  }

  function buildThumbsEditHtml() {
    syncEditingRef();
    if (!editingPropertyRef) return "";
    ensureImagesShape(editingPropertyRef);
    var thumbs = editingPropertyRef.images.thumbs;
    var html = "";
    for (var i = 0; i < thumbs.length; i++) {
      html +=
        '<div class="cms-thumb-cell">' +
        '<img src="' +
        escapeHtml(thumbs[i]) +
        '" alt="">' +
        '<button type="button" class="cms-thumb-rm" data-thumb-i="' +
        i +
        '" aria-label="Remove thumbnail">&times;</button>' +
        "</div>";
    }
    if (thumbs.length < MAX_THUMBS) {
      html += '<div class="cms-thumb-add" id="cmsAddThumb" title="Add thumbnail">+</div>';
    }
    return '<div class="cms-thumbs-grid" id="cmsThumbsGrid">' + html + "</div>";
  }

  function bindEditModalImageEvents() {
    var heroFile = document.getElementById("cmsHeroFile");
    var thumbFile = document.getElementById("cmsThumbFile");
    var drop = document.getElementById("cmsHeroDrop");
    var pick = document.getElementById("cmsPickHero");
    var rmHero = document.getElementById("cmsRemoveHero");
    var addThumb = document.getElementById("cmsAddThumb");

    if (drop && heroFile) {
      drop.onclick = function () {
        heroFile.click();
      };
    }
    if (pick && heroFile) {
      pick.onclick = function () {
        heroFile.click();
      };
    }
    if (rmHero) {
      rmHero.onclick = function () {
        removeHeroImage();
      };
    }
    if (heroFile) {
      heroFile.onchange = function () {
        var f = heroFile.files && heroFile.files[0];
        if (f) setHeroImage(f);
        heroFile.value = "";
      };
    }
    if (addThumb && thumbFile) {
      addThumb.onclick = function () {
        thumbFile.click();
      };
    }
    if (thumbFile) {
      thumbFile.onchange = function () {
        var f = thumbFile.files && thumbFile.files[0];
        if (f) addThumbnail(f);
        thumbFile.value = "";
      };
    }
    document.querySelectorAll(".cms-thumb-rm").forEach(function (btn) {
      btn.onclick = function () {
        removeThumbnail(parseInt(btn.getAttribute("data-thumb-i"), 10));
      };
    });
  }

  function refreshEditModalImagesOnly() {
    var heroWrap = document.getElementById("cmsHeroMount");
    var thumbsWrap = document.getElementById("cmsThumbsMount");
    if (heroWrap) {
      heroWrap.innerHTML = buildHeroEditHtml();
    }
    if (thumbsWrap) {
      thumbsWrap.innerHTML = buildThumbsEditHtml();
    }
    bindEditModalImageEvents();
  }

  function openModal(property) {
    currentEditId = property.id;
    editingPropertyRef = getPropertyById(property.id);
    if (!editingPropertyRef) return;
    ensureImagesShape(editingPropertyRef);

    var el = document.getElementById("cmsEditModal");
    var inner = document.getElementById("cmsEditInner");
    if (!inner) return;

    inner.innerHTML =
      '<div class="cms-modal-head"><span>Edit listing</span>' +
      '<button type="button" class="cms-modal-close" id="cmsEditClose" aria-label="Close">&times;</button></div>' +
      '<div class="cms-modal-body">' +
      '<div class="cms-field"><label class="cms-label" for="cmsInpTitle">Title</label>' +
      '<input type="text" id="cmsInpTitle" class="cms-input" value="' +
      escapeHtml(editingPropertyRef.title) +
      '"></div>' +
      '<div class="cms-field"><label class="cms-label" for="cmsInpPrice">Price (USD)</label>' +
      '<input type="number" id="cmsInpPrice" class="cms-input" min="0" step="1" value="' +
      escapeHtml(String(editingPropertyRef.price)) +
      '"></div>' +
      '<div class="cms-field"><label class="cms-label" for="cmsInpLoc">Location</label>' +
      '<input type="text" id="cmsInpLoc" class="cms-input" value="' +
      escapeHtml(editingPropertyRef.location) +
      '"></div>' +
      '<div class="cms-field"><label class="cms-label" for="cmsInpDesc">Description</label>' +
      '<textarea id="cmsInpDesc" class="cms-textarea">' +
      escapeHtml(editingPropertyRef.description) +
      "</textarea></div>" +
      '<div class="cms-field"><span class="cms-label">Hero image</span>' +
      '<input type="file" id="cmsHeroFile" accept="image/*">' +
      '<div id="cmsHeroMount">' +
      buildHeroEditHtml() +
      "</div></div>" +
      '<div class="cms-field"><span class="cms-label">Thumbnails (max ' +
      MAX_THUMBS +
      ")</span>" +
      '<input type="file" id="cmsThumbFile" accept="image/*">' +
      '<div id="cmsThumbsMount">' +
      buildThumbsEditHtml() +
      "</div></div>" +
      '<div class="cms-actions-row">' +
      '<button type="button" class="cms-btn-del" id="cmsDeleteProperty">Delete property</button>' +
      "</div></div>";

    el.classList.add("cms-modal-open");
    el.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    var titleEl = document.getElementById("cmsInpTitle");
    var priceEl = document.getElementById("cmsInpPrice");
    var locEl = document.getElementById("cmsInpLoc");
    var descEl = document.getElementById("cmsInpDesc");

    function liveSave() {
      syncEditingRef();
      if (!editingPropertyRef) return;
      editingPropertyRef.title = (titleEl && titleEl.value) || "";
      editingPropertyRef.price = priceEl ? parseInt(priceEl.value, 10) || 0 : 0;
      editingPropertyRef.location = (locEl && locEl.value) || "";
      editingPropertyRef.description = (descEl && descEl.value) || "";
      saveProperties().then(function (ok) {
        if (!ok) return;
        clearCmsGridRenderTimer();
        cmsGridRenderTimer = setTimeout(function () {
          cmsGridRenderTimer = null;
          renderProperties();
          setupScrollAnimations();
        }, 250);
      });
    }

    if (titleEl) titleEl.addEventListener("input", liveSave);
    if (priceEl) priceEl.addEventListener("input", liveSave);
    if (locEl) locEl.addEventListener("input", liveSave);
    if (descEl) descEl.addEventListener("input", liveSave);

    document.getElementById("cmsEditClose").onclick = closeModal;
    document.getElementById("cmsDeleteProperty").onclick = function () {
      if (confirm('Delete "' + (editingPropertyRef.title || "this listing") + '"?')) {
        deleteProperty(currentEditId);
      }
    };

    bindEditModalImageEvents();

    el.onclick = function (e) {
      if (e.target === el) closeModal();
    };
  }

  function closeModalOnly() {
    clearCmsGridRenderTimer();
    var el = document.getElementById("cmsEditModal");
    if (!el) return;
    el.classList.remove("cms-modal-open");
    el.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    currentEditId = null;
    editingPropertyRef = null;
    var inner = document.getElementById("cmsEditInner");
    if (inner) inner.innerHTML = "";
  }

  function closeModal() {
    flushEditFormToProperty();
    saveProperties().then(function (ok) {
      if (!ok) return;
      closeModalOnly();
    });
  }

  function addProperty() {
    var maxId = 0;
    for (var i = 0; i < properties.length; i++) {
      if (properties[i].id > maxId) maxId = properties[i].id;
    }
    var p = {
      id: maxId + 1,
      title: "",
      price: 0,
      location: "",
      description: "",
      images: { hero: null, thumbs: [] }
    };
    properties.push(p);
    saveProperties().then(function (ok) {
      if (!ok) {
        properties.pop();
        return;
      }
      renderProperties();
      setupScrollAnimations();
      openModal(p);
    });
  }

  function deleteProperty(id) {
    var next = [];
    for (var i = 0; i < properties.length; i++) {
      if (properties[i].id !== id) next.push(properties[i]);
    }
    var prev = properties;
    properties = next;
    saveProperties().then(function (ok) {
      if (!ok) {
        properties = prev;
        return;
      }
      closeModalOnly();
      renderProperties();
    });
  }

  function setHeroImage(file) {
    if (!file || currentEditId == null) return;
    syncEditingRef();
    if (!editingPropertyRef) return;
    ensureImagesShape(editingPropertyRef);
    var fr = new FileReader();
    fr.onload = function (e) {
      var raw = e.target.result;
      compressDataUrl(raw, 1280, 0.78, function (smaller) {
        if (currentEditId == null) return;
        syncEditingRef();
        if (!editingPropertyRef) return;
        ensureImagesShape(editingPropertyRef);
        editingPropertyRef.images.hero = smaller;
        saveProperties().then(function (ok) {
          if (!ok) return;
          renderProperties();
          setupScrollAnimations();
          refreshEditModalImagesOnly();
        });
      });
    };
    fr.readAsDataURL(file);
  }

  function removeHeroImage() {
    syncEditingRef();
    if (!editingPropertyRef) return;
    ensureImagesShape(editingPropertyRef);
    editingPropertyRef.images.hero = null;
    saveProperties().then(function (ok) {
      if (!ok) return;
      renderProperties();
      setupScrollAnimations();
      refreshEditModalImagesOnly();
    });
  }

  function addThumbnail(file) {
    if (!file || currentEditId == null) return;
    syncEditingRef();
    if (!editingPropertyRef) return;
    ensureImagesShape(editingPropertyRef);
    if (editingPropertyRef.images.thumbs.length >= MAX_THUMBS) return;
    var fr = new FileReader();
    fr.onload = function (e) {
      var raw = e.target.result;
      compressDataUrl(raw, 960, 0.78, function (smaller) {
        if (currentEditId == null) return;
        syncEditingRef();
        if (!editingPropertyRef) return;
        ensureImagesShape(editingPropertyRef);
        if (editingPropertyRef.images.thumbs.length >= MAX_THUMBS) return;
        editingPropertyRef.images.thumbs.push(smaller);
        saveProperties().then(function (ok) {
          if (!ok) return;
          renderProperties();
          setupScrollAnimations();
          refreshEditModalImagesOnly();
        });
      });
    };
    fr.readAsDataURL(file);
  }

  function removeThumbnail(index) {
    syncEditingRef();
    if (!editingPropertyRef || index < 0) return;
    ensureImagesShape(editingPropertyRef);
    editingPropertyRef.images.thumbs.splice(index, 1);
    saveProperties().then(function (ok) {
      if (!ok) return;
      renderProperties();
      setupScrollAnimations();
      refreshEditModalImagesOnly();
    });
  }

  function peVal(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || "") : "";
  }

  function openPageSectionModal(title, bodyHtml) {
    var modal = document.getElementById("pageSectionModal");
    var inner = document.getElementById("pageSectionInner");
    if (!inner || !modal) return;
    inner.innerHTML =
      '<div class="cms-modal-head"><span>' +
      escapeHtml(title) +
      '</span><button type="button" class="cms-modal-close" id="pageSectionClose" aria-label="Close">&times;</button></div>' +
      '<div class="cms-modal-body">' +
      bodyHtml +
      "</div>";
    modal.classList.add("cms-modal-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    var cb = document.getElementById("pageSectionClose");
    if (cb) cb.onclick = closePageSectionModal;
    modal.onclick = function (e) {
      if (e.target === modal) closePageSectionModal();
    };
  }

  function closePageSectionModal() {
    var modal = document.getElementById("pageSectionModal");
    if (!modal) return;
    modal.classList.remove("cms-modal-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    var inner = document.getElementById("pageSectionInner");
    if (inner) inner.innerHTML = "";
  }

  function openHeroEditor() {
    var h = getSiteData().hero || {};
    openPageSectionModal(
      "Hero (top of page)",
      '<div class="cms-field"><label class="cms-label" for="peHeroBadge">Badge</label>' +
        '<input type="text" id="peHeroBadge" class="cms-input" value="' +
        escapeHtml(h.badge || "") +
        '"></div>' +
        '<div class="cms-field"><label class="cms-label" for="peHeroMain">Title line 1</label>' +
        '<input type="text" id="peHeroMain" class="cms-input" value="' +
        escapeHtml(h.titleMain || "") +
        '"></div>' +
        '<div class="cms-field"><label class="cms-label" for="peHeroSpan">Title line 2 (accent)</label>' +
        '<input type="text" id="peHeroSpan" class="cms-input" value="' +
        escapeHtml(h.titleSpan || "") +
        '"></div>' +
        '<div class="cms-field"><label class="cms-label" for="peHeroSub">Subtitle</label>' +
        '<textarea id="peHeroSub" class="cms-textarea" rows="3">' +
        escapeHtml(h.subtitle || "") +
        "</textarea></div>" +
        '<div class="pe-save-row"><button type="button" class="btn btn-primary" id="peSaveHero">Save</button></div>'
    );
    document.getElementById("peSaveHero").onclick = function () {
      siteOverrides.hero = {
        badge: peVal("peHeroBadge"),
        titleMain: peVal("peHeroMain"),
        titleSpan: peVal("peHeroSpan"),
        subtitle: peVal("peHeroSub")
      };
      saveSiteOverrides().then(function (ok) {
        if (!ok) return;
        refreshPageFromSiteData();
        closePageSectionModal();
      });
    };
  }

  function openFeaturedEditor() {
    var p = getSiteData().propertiesSection || {};
    openPageSectionModal(
      "Featured listings header",
      '<div class="cms-field"><label class="cms-label" for="peFeatLbl">Small label</label>' +
        '<input type="text" id="peFeatLbl" class="cms-input" value="' +
        escapeHtml(p.sectionLabel || "") +
        '"></div>' +
        '<div class="cms-field"><label class="cms-label" for="peFeatTitle">Title</label>' +
        '<input type="text" id="peFeatTitle" class="cms-input" value="' +
        escapeHtml(p.title || "") +
        '"></div>' +
        '<div class="cms-field"><label class="cms-label" for="peFeatSub">Subtitle</label>' +
        '<textarea id="peFeatSub" class="cms-textarea" rows="4">' +
        escapeHtml(p.subtitle || "") +
        "</textarea></div>" +
        '<div class="pe-save-row"><button type="button" class="btn btn-primary" id="peSaveFeat">Save</button></div>'
    );
    document.getElementById("peSaveFeat").onclick = function () {
      siteOverrides.propertiesSection = {
        sectionLabel: peVal("peFeatLbl"),
        title: peVal("peFeatTitle"),
        subtitle: peVal("peFeatSub")
      };
      saveSiteOverrides().then(function (ok) {
        if (!ok) return;
        refreshPageFromSiteData();
        closePageSectionModal();
      });
    };
  }

  function buildAboutParagraphsHtml(paras) {
    var html = "";
    for (var i = 0; i < paras.length; i++) {
      html +=
        '<div class="pe-row" data-pi="' +
        i +
        '"><textarea class="cms-textarea" rows="3" style="flex:1" data-pfield="p">' +
        escapeHtml(paras[i]) +
        "</textarea>" +
        '<button type="button" class="pe-btn-xs pe-rm-p">×</button></div>';
    }
    return '<div id="peAboutParas">' + html + "</div>" + '<button type="button" class="cms-btn-sm" id="peAddP">+ Add paragraph</button>';
  }

  function buildAboutStatsHtml(stats) {
    var html = "";
    for (var j = 0; j < stats.length; j++) {
      html +=
        '<div class="pe-row" data-si="' +
        j +
        '"><input type="text" class="cms-input" style="max-width:100px" data-sfield="n" value="' +
        escapeHtml(stats[j].number || "") +
        '">' +
        '<input type="text" class="cms-input" data-sfield="l" value="' +
        escapeHtml(stats[j].label || "") +
        '">' +
        '<button type="button" class="pe-btn-xs pe-rm-s">×</button></div>';
    }
    return '<div id="peAboutStats">' + html + "</div>" + '<button type="button" class="cms-btn-sm" id="peAddS">+ Add stat</button>';
  }

  function collectAboutParas() {
    var out = [];
    document.querySelectorAll("#peAboutParas .pe-row").forEach(function (row) {
      var ta = row.querySelector("textarea[data-pfield=p]");
      if (ta) {
        var t = String(ta.value || "").trim();
        if (t) out.push(t);
      }
    });
    return out;
  }

  function collectAboutStats() {
    var out = [];
    document.querySelectorAll("#peAboutStats .pe-row").forEach(function (row) {
      var n = row.querySelector("input[data-sfield=n]");
      var l = row.querySelector("input[data-sfield=l]");
      if (n && l) {
        out.push({ number: String(n.value || "").trim(), label: String(l.value || "").trim() });
      }
    });
    return out;
  }

  function openAboutEditor() {
    var a = clone(getSiteData().about || {});
    if (!a.paragraphs) a.paragraphs = [""];
    if (!a.stats) a.stats = [{ number: "", label: "" }];
    openPageSectionModal(
      "Our Story section",
      '<div class="cms-field"><label class="cms-label" for="peAbLbl">Small label</label>' +
        '<input type="text" id="peAbLbl" class="cms-input" value="' +
        escapeHtml(a.sectionLabel || "") +
        '"></div>' +
        '<div class="cms-field"><label class="cms-label" for="peAbTitle">Main title</label>' +
        '<input type="text" id="peAbTitle" class="cms-input" value="' +
        escapeHtml(a.title || "") +
        '"></div>' +
        '<div class="cms-field"><span class="cms-label">Paragraphs</span>' +
        buildAboutParagraphsHtml(a.paragraphs) +
        "</div>" +
        '<div class="cms-field"><span class="cms-label">Stats (number + label)</span>' +
        buildAboutStatsHtml(a.stats) +
        "</div>" +
        '<div class="cms-field"><label class="cms-label" for="peAbEmoji">Emoji (if no photo)</label>' +
        '<input type="text" id="peAbEmoji" class="cms-input" placeholder="⛰️" value="' +
        escapeHtml(a.emoji != null ? a.emoji : "") +
        '"></div>' +
        '<div class="cms-field"><span class="cms-label">Photo beside story</span>' +
        '<input type="file" id="peAbImgFile" accept="image/*" style="display:block;margin-top:0.35rem">' +
        '<p style="font-size:0.78rem;color:#5C3A1E;margin-top:0.35rem">Upload replaces the mountain icon. Use Remove to go back to emoji.</p>' +
        '<button type="button" class="cms-btn-sm" id="peAbImgRm" style="margin-top:0.4rem">Remove photo</button></div>' +
        '<div class="pe-save-row"><button type="button" class="btn btn-primary" id="peSaveAbout">Save</button></div>'
    );

    document.getElementById("peAddP").onclick = function () {
      var c = document.getElementById("peAboutParas");
      if (!c) return;
      var div = document.createElement("div");
      div.className = "pe-row";
      div.innerHTML =
        '<textarea class="cms-textarea" rows="3" style="flex:1" data-pfield="p"></textarea>' +
        '<button type="button" class="pe-btn-xs pe-rm-p">×</button>';
      c.appendChild(div);
      div.querySelector(".pe-rm-p").onclick = function () {
        div.remove();
      };
    };
    document.querySelectorAll(".pe-rm-p").forEach(function (b) {
      b.onclick = function () {
        b.closest(".pe-row").remove();
      };
    });

    document.getElementById("peAddS").onclick = function () {
      var c = document.getElementById("peAboutStats");
      if (!c) return;
      var div = document.createElement("div");
      div.className = "pe-row";
      div.innerHTML =
        '<input type="text" class="cms-input" style="max-width:100px" data-sfield="n" value="">' +
        '<input type="text" class="cms-input" data-sfield="l" value="">' +
        '<button type="button" class="pe-btn-xs pe-rm-s">×</button>';
      c.appendChild(div);
      div.querySelector(".pe-rm-s").onclick = function () {
        div.remove();
      };
    };
    document.querySelectorAll(".pe-rm-s").forEach(function (b) {
      b.onclick = function () {
        b.closest(".pe-row").remove();
      };
    });

    var pendingAboutImage = a.image || null;

    document.getElementById("peAbImgRm").onclick = function () {
      pendingAboutImage = null;
      alert("Photo will be removed after you click Save.");
    };

    var imgFile = document.getElementById("peAbImgFile");
    if (imgFile) {
      imgFile.onchange = function () {
        var f = imgFile.files && imgFile.files[0];
        if (!f) return;
        var fr = new FileReader();
        fr.onload = function (e) {
          compressDataUrl(e.target.result, 1400, 0.78, function (smaller) {
            pendingAboutImage = smaller;
          });
        };
        fr.readAsDataURL(f);
        imgFile.value = "";
      };
    }

    document.getElementById("peSaveAbout").onclick = function () {
      siteOverrides.about = {
        sectionLabel: peVal("peAbLbl"),
        title: peVal("peAbTitle"),
        paragraphs: collectAboutParas(),
        stats: collectAboutStats(),
        emoji: peVal("peAbEmoji") || "\u26F0\uFE0F",
        image: pendingAboutImage
      };
      saveSiteOverrides().then(function (ok) {
        if (!ok) return;
        refreshPageFromSiteData();
        closePageSectionModal();
      });
    };
  }

  function buildWhyItemsHtml(items) {
    var html = "";
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      html +=
        '<div class="cms-field pe-why-item" data-wi="' +
        i +
        '" style="border:1px solid rgba(166,124,82,0.25);padding:0.65rem;border-radius:6px;margin-bottom:0.65rem;">' +
        '<div class="pe-row"><label class="cms-label" style="margin:0">Icon (emoji)</label>' +
        '<input type="text" class="cms-input" data-wf="icon" value="' +
        escapeHtml(it.icon || "") +
        '"></div>' +
        '<div class="cms-field" style="margin-bottom:0.4rem"><label class="cms-label">Title</label>' +
        '<input type="text" class="cms-input" data-wf="title" value="' +
        escapeHtml(it.title || "") +
        '"></div>' +
        '<div class="cms-field" style="margin-bottom:0.4rem"><label class="cms-label">Description</label>' +
        '<textarea class="cms-textarea" rows="2" data-wf="desc">' +
        escapeHtml(it.desc || "") +
        "</textarea></div>" +
        '<div class="pe-row">' +
        '<button type="button" class="pe-btn-xs pe-why-up">▲</button>' +
        '<button type="button" class="pe-btn-xs pe-why-down">▼</button>' +
        '<button type="button" class="pe-btn-xs pe-why-del">Remove</button>' +
        "</div></div>";
    }
    return '<div id="peWhyItems">' + html + "</div>";
  }

  function collectWhyItems() {
    var out = [];
    document.querySelectorAll("#peWhyItems .pe-why-item").forEach(function (box) {
      var ei = box.querySelector('[data-wf="icon"]');
      var et = box.querySelector('[data-wf="title"]');
      var ed = box.querySelector('[data-wf="desc"]');
      out.push({
        icon: ei ? ei.value : "",
        title: et ? et.value : "",
        desc: ed ? ed.value : ""
      });
    });
    return out;
  }

  function wireWhyItemButtons() {
    document.querySelectorAll("#peWhyItems .pe-why-up").forEach(function (btn) {
      btn.onclick = function () {
        var row = btn.closest(".pe-why-item");
        var p = row && row.previousElementSibling;
        if (p && p.classList.contains("pe-why-item")) row.parentNode.insertBefore(row, p);
      };
    });
    document.querySelectorAll("#peWhyItems .pe-why-down").forEach(function (btn) {
      btn.onclick = function () {
        var row = btn.closest(".pe-why-item");
        var n = row && row.nextElementSibling;
        if (n && n.classList.contains("pe-why-item")) row.parentNode.insertBefore(n, row);
      };
    });
    document.querySelectorAll("#peWhyItems .pe-why-del").forEach(function (btn) {
      btn.onclick = function () {
        var row = btn.closest(".pe-why-item");
        if (row) row.remove();
      };
    });
  }

  function openWhyUsEditor() {
    var w = clone(getSiteData().whyUs || {});
    if (!w.items || !w.items.length) w.items = [{ icon: "", title: "", desc: "" }];
    openPageSectionModal(
      "Why Bulldomingo",
      '<div class="cms-field"><label class="cms-label" for="peWhyLbl">Small label</label>' +
        '<input type="text" id="peWhyLbl" class="cms-input" value="' +
        escapeHtml(w.sectionLabel || "") +
        '"></div>' +
        '<div class="cms-field"><label class="cms-label" for="peWhyTitle">Section title</label>' +
        '<input type="text" id="peWhyTitle" class="cms-input" value="' +
        escapeHtml(w.title || "") +
        '"></div>' +
        '<div class="cms-field"><span class="cms-label">Cards</span>' +
        buildWhyItemsHtml(w.items) +
        '<button type="button" class="cms-btn-sm" id="peWhyAdd">+ Add card</button></div>' +
        '<div class="pe-save-row"><button type="button" class="btn btn-primary" id="peSaveWhy">Save</button></div>'
    );
    wireWhyItemButtons();

    document.getElementById("peWhyAdd").onclick = function () {
      var c = document.getElementById("peWhyItems");
      if (!c) return;
      var div = document.createElement("div");
      div.className = "cms-field pe-why-item";
      div.setAttribute("data-wi", String(c.children.length));
      div.style.cssText =
        "border:1px solid rgba(166,124,82,0.25);padding:0.65rem;border-radius:6px;margin-bottom:0.65rem;";
      div.innerHTML =
        '<div class="pe-row"><label class="cms-label" style="margin:0">Icon (emoji)</label>' +
        '<input type="text" class="cms-input" data-wf="icon" value=""></div>' +
        '<div class="cms-field" style="margin-bottom:0.4rem"><label class="cms-label">Title</label>' +
        '<input type="text" class="cms-input" data-wf="title" value=""></div>' +
        '<div class="cms-field" style="margin-bottom:0.4rem"><label class="cms-label">Description</label>' +
        '<textarea class="cms-textarea" rows="2" data-wf="desc"></textarea></div>' +
        '<div class="pe-row">' +
        '<button type="button" class="pe-btn-xs pe-why-up">▲</button>' +
        '<button type="button" class="pe-btn-xs pe-why-down">▼</button>' +
        '<button type="button" class="pe-btn-xs pe-why-del">Remove</button></div>';
      c.appendChild(div);
      wireWhyItemButtons();
    };

    document.getElementById("peSaveWhy").onclick = function () {
      siteOverrides.whyUs = {
        sectionLabel: peVal("peWhyLbl"),
        title: peVal("peWhyTitle"),
        items: collectWhyItems()
      };
      saveSiteOverrides().then(function (ok) {
        if (!ok) return;
        refreshPageFromSiteData();
        closePageSectionModal();
      });
    };
  }

  function openContactFooterEditor() {
    var site = getSiteData();
    var c = site.contact || {};
    var f = site.footer || {};
    openPageSectionModal(
      "Contact & footer",
      '<div class="cms-field"><span class="cms-label">Contact block</span></div>' +
        '<div class="cms-field"><label class="cms-label" for="peCtLbl">Small label</label>' +
        '<input type="text" id="peCtLbl" class="cms-input" value="' +
        escapeHtml(c.sectionLabel || "") +
        '"></div>' +
        '<div class="cms-field"><label class="cms-label" for="peCtTitle">Title</label>' +
        '<input type="text" id="peCtTitle" class="cms-input" value="' +
        escapeHtml(c.title || "") +
        '"></div>' +
        '<div class="cms-field"><label class="cms-label" for="peCtSub">Subtitle</label>' +
        '<textarea id="peCtSub" class="cms-textarea" rows="3">' +
        escapeHtml(c.subtitle || "") +
        "</textarea></div>" +
        '<div class="cms-field"><label class="cms-label" for="peCtEmail">Sales email</label>' +
        '<input type="email" id="peCtEmail" class="cms-input" value="' +
        escapeHtml(c.salesEmail || "") +
        '"></div>' +
        '<div class="cms-field"><span class="cms-label">Footer</span></div>' +
        '<div class="cms-field"><label class="cms-label" for="peFtCopy">Copyright line</label>' +
        '<input type="text" id="peFtCopy" class="cms-input" value="' +
        escapeHtml(f.copy || "") +
        '"></div>' +
        '<div class="pe-save-row"><button type="button" class="btn btn-primary" id="peSaveCt">Save</button></div>'
    );
    document.getElementById("peSaveCt").onclick = function () {
      siteOverrides.contact = {
        sectionLabel: peVal("peCtLbl"),
        title: peVal("peCtTitle"),
        subtitle: peVal("peCtSub"),
        salesEmail: peVal("peCtEmail")
      };
      siteOverrides.footer = {
        copy: peVal("peFtCopy")
      };
      saveSiteOverrides().then(function (ok) {
        if (!ok) return;
        refreshPageFromSiteData();
        closePageSectionModal();
      });
    };
  }

  /* ================================================================
     EXPORT site-data.js — bakes current state into a downloadable file
  ================================================================ */
  function exportSiteDataJs() {
    var site = getSiteData();

    // Convert current properties array back into the listings format site-data.js expects
    var listings = properties.map(function (p) {
      var imgs = p.images || { hero: null, thumbs: [] };
      var hero = imgs.hero;
      var thumbs = imgs.thumbs || [];

      if (hero) {
        return {
          type: "photos",
          badge: "New Listing",
          badgeClass: "",
          location: p.location || "",
          title: p.title || "",
          description: p.description || "",
          heroImage: hero,
          heroAlt: p.title || "",
          thumbImages: thumbs,
          details: [],
          price: formatPrice(p.price),
          pricePerAcre: ""
        };
      }
      var themes = ["meadow", "desert", "mountain", "forest", "plains", "lakefront"];
      var theme = themes[(Number(p.id) || 0) % themes.length];
      var emojis = { meadow: "🌾", desert: "🏜️", mountain: "🏔️", forest: "🌲", plains: "🌿", lakefront: "🏞️" };
      return {
        type: "theme",
        theme: theme,
        emoji: emojis[theme] || "🌾",
        badge: "New Listing",
        badgeClass: "",
        location: p.location || "",
        title: p.title || "",
        description: p.description || "",
        details: [],
        price: formatPrice(p.price),
        pricePerAcre: ""
      };
    });

    // Build the full site object
    var exportObj = {
      hero: site.hero,
      propertiesSection: site.propertiesSection,
      listings: listings,
      about: site.about,
      whyUs: site.whyUs,
      contact: site.contact,
      footer: site.footer
    };

    var json = JSON.stringify(exportObj, null, 2);
    var fileContent =
      "/**\n" +
      " * Bulldomingo — site content\n" +
      " * Exported on " + new Date().toLocaleString() + "\n" +
      " * Drop this file next to index.html and site-app.js\n" +
      " */\n" +
      "window.BULLDOMINGO_SITE = " + json + ";\n";

    var blob = new Blob([fileContent], { type: "application/javascript" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "site-data.js";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);

    alert("✅ site-data.js downloaded!\\n\\nReplace the old site-data.js in your folder with this one, then push to GitHub. Your changes are now permanent.");
  }

  function setupEditModeUi() {
    if (!isEditMode()) return;
    injectCmsStyles();
    document.body.classList.add("edit-mode-active");
    var toolbar = document.getElementById("editModeToolbar");
    if (toolbar) {
      toolbar.style.display = "";
      toolbar.setAttribute("aria-hidden", "false");
    }
    var btn = document.getElementById("btnAddProperty");
    if (btn) btn.onclick = addProperty;

    var h = document.getElementById("btnEditHero");
    if (h) h.onclick = openHeroEditor;
    var f = document.getElementById("btnEditFeatured");
    if (f) f.onclick = openFeaturedEditor;
    var ab = document.getElementById("btnEditAbout");
    if (ab) ab.onclick = openAboutEditor;
    var wy = document.getElementById("btnEditWhyUs");
    if (wy) wy.onclick = openWhyUsEditor;
    var cf = document.getElementById("btnEditContact");
    if (cf) cf.onclick = openContactFooterEditor;
    var ex = document.getElementById("btnExportSiteData");
    if (ex) ex.onclick = exportSiteDataJs;
  }

  /* ================================================================
     INIT
  ================================================================ */
  function finishInit() {
    var site = getSiteData();
    renderHero(site);
    renderPropertiesHeader(site);
    renderProperties();
    renderAbout(site);
    renderAboutVisual(site);
    renderWhyUs(site);
    renderContact(site);
    renderFooter(site);
    setupScrollAnimations();
    setupContactForm(site);
    setupSmoothScroll();
    setupViewModalEvents();
    setupCardClickHandlers();
    setupStorageSync();
    setupEditModeUi();

    window.addEventListener("beforeunload", function () {
      var cms = document.getElementById("cmsEditModal");
      if (cms && cms.classList.contains("cms-modal-open")) {
        flushEditFormToProperty();
        saveProperties();
      }
    });

    window.BULLDOMINGO_CMS = {
      saveProperties: saveProperties,
      renderProperties: renderProperties,
      openModal: openModal,
      closeModal: closeModal,
      addProperty: addProperty,
      deleteProperty: deleteProperty,
      setHeroImage: setHeroImage,
      removeHeroImage: removeHeroImage,
      addThumbnail: addThumbnail,
      removeThumbnail: removeThumbnail,
      getProperties: function () {
        return properties;
      },
      saveSiteOverrides: saveSiteOverrides,
      refreshPageFromSiteData: refreshPageFromSiteData,
      getSiteData: getSiteData
    };
  }

  function init() {
    if (!window.BULLDOMINGO_SITE) {
      var grid = document.getElementById("propertiesGrid");
      if (grid)
        grid.innerHTML =
          '<p style="padding:1rem;color:#5C3A1E;">Missing <strong>site-data.js</strong>.</p>';
      return;
    }

    loadPropertiesAsync()
      .then(function (arr) {
        properties = arr;
        return idbGetListingsJson();
      })
      .then(function (idbRaw) {
        if (idbRaw === null && properties.length) {
          return saveProperties();
        }
      })
      .then(function () {
        return loadSiteOverridesAsync();
      })
      .then(function () {
        finishInit();
      })
      .catch(function () {
        properties = loadPropertiesFromSite();
        saveProperties()
          .then(function () {
            return loadSiteOverridesAsync();
          })
          .then(finishInit, finishInit);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
