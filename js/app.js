const products = window.CAPSTREET_PRODUCTS;
const CHECKOUT_API_URL = window.CAPSTREET_CONFIG?.checkoutApiUrl ||
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "https://capstreet-api.onrender.com");
const CHECKOUT_PENDING_KEY = "capstreet-checkout-pending";

    function loadSavedCart() {
      try {
        const savedCart = localStorage.getItem("capstreet-cart");
        if (!savedCart) return new Map();
        const entries = JSON.parse(savedCart);
        if (!Array.isArray(entries)) throw new TypeError("El carrito guardado no es una lista válida.");
        return new Map(entries.filter(([id, quantity]) =>
          products.some(product => product.id === id) &&
          Number.isInteger(quantity) &&
          quantity > 0 &&
          quantity <= 99
        ));
      } catch (error) {
        console.error("No se pudo recuperar el carrito guardado.", error);
        return new Map();
      }
    }

    const cart = loadSavedCart();
    const favorites = new Set();
    const SUPABASE_URL = window.CAPSTREET_CONFIG.supabaseUrl;
    const SUPABASE_ANON_KEY = window.CAPSTREET_CONFIG.supabaseAnonKey;
    const supabaseClient = window.supabase?.createClient
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
          storageKey: "capstreet-supabase-auth"
        }
      })
      : null;
    let activeFilter = "Gorras";
    let toastTimer;
    let accountEmail = "";
    let accountProfile = null;
    let accountMode = "login";
    let accountPreviousFocus = null;
    let accountBusy = false;
    let checkoutBusy = false;
    let checkoutPending = localStorage.getItem(CHECKOUT_PENDING_KEY) === "true";

    function capSvg(product, className = "product-art") {
      const { color, brim, patch, label } = product;
      return `<svg class="${className}" viewBox="0 0 360 260" role="img" aria-label="Gorra ${product.name}">
        <path d="M53 153C59 85 105 36 174 32c54-3 100 35 119 95l-6 28c-67 15-149 17-234-2z" fill="${color}"/>
        <path d="M53 153c-9 5-18 17-16 29 2 11 15 18 34 21 51 9 121 3 177-12 23-6 46-17 48-31 1-9-5-21-10-28-67 21-157 34-233 21z" fill="${brim}"/>
        <path d="M174 33c3 40 4 78 2 119M111 51c18 34 31 68 39 105M233 50c-17 35-30 70-39 105" fill="none" stroke="rgba(110,110,102,.55)" stroke-width="2"/>
        <path d="M174 33c3-10 15-12 24-7" fill="none" stroke="rgba(130,130,120,.7)" stroke-width="3" stroke-linecap="round"/>
        <path d="M66 159c60 14 153 4 226-17M104 187c54 8 111 2 155-11" fill="none" stroke="rgba(125,125,115,.65)" stroke-width="2" stroke-dasharray="3 5"/>
        <rect x="149" y="108" width="48" height="25" rx="2" fill="${patch}"/>
        <text x="173" y="124" text-anchor="middle" fill="${patch === "#171715" ? "#f5f4ee" : "#171715"}" font-family="Arial,sans-serif" font-size="9" font-weight="700" letter-spacing="1">${label}</text>
      </svg>`;
    }

    function productArt(product, className = "product-art") {
      if (product.type === "cap") return capSvg(product, className);
      const { color, brim, label } = product;
      const drawings = {
        shirt: `<path d="m105 62 37-19h76l37 19 39 35-31 34-24-21v105H101V110l-24 21-31-34z" fill="${color}" stroke="#77766f" stroke-width="2"/><path d="M142 43c2 20 74 20 76 0" fill="none" stroke="#77766f" stroke-width="2"/><text x="180" y="139" text-anchor="middle" fill="${brim}" font-family="Arial,sans-serif" font-size="12" font-weight="700" letter-spacing="1">${label}</text>`,
        hoodie: `<path d="M119 77c-7-31 19-49 61-49s68 18 61 49l28 15 34 39-30 27-21-19v78H108v-78l-21 19-30-27 34-39z" fill="${color}" stroke="#77766f" stroke-width="2"/><path d="M136 57c5 31 83 31 88 0M136 57l10 48m58-48-10 48M143 107h74v31h-74z" fill="none" stroke="#77766f" stroke-width="2"/><text x="180" y="128" text-anchor="middle" fill="${brim}" font-family="Arial,sans-serif" font-size="10" font-weight="700">${label}</text>`,
        chain: `<path d="M80 48c0 143 200 143 200 0" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round" stroke-dasharray="2 7"/><path d="M80 48c0 143 200 143 200 0" fill="none" stroke="${brim}" stroke-width="3"/><path d="m180 163 22 22-22 39-22-39z" fill="${color}" stroke="${brim}" stroke-width="3"/><text x="180" y="199" text-anchor="middle" fill="${brim}" font-family="Arial,sans-serif" font-size="9" font-weight="700">${label}</text>`,
        bracelet: `<ellipse cx="180" cy="130" rx="105" ry="69" fill="none" stroke="${color}" stroke-width="24"/><ellipse cx="180" cy="130" rx="105" ry="69" fill="none" stroke="${brim}" stroke-width="3" stroke-dasharray="2 8"/><rect x="163" y="53" width="34" height="27" rx="4" fill="${brim}"/><text x="180" y="71" text-anchor="middle" fill="${color}" font-family="Arial,sans-serif" font-size="9" font-weight="700">${label}</text>`,
        sneaker: `<path d="M65 149c20-5 38-20 51-51l15-38 35 13c4 31 23 48 53 60l66 25c15 6 24 16 24 29 0 16-13 25-35 25H75c-23 0-39-11-39-29 0-15 10-28 29-34z" fill="${color}" stroke="#77766f" stroke-width="3"/><path d="M36 177h270c-1 24-17 35-38 35H75c-24 0-38-11-39-35z" fill="${brim}" stroke="#77766f" stroke-width="2"/><path d="m124 96 49 15m-57-1 45 14m-53 1 43 13m-11-68 5 38" fill="none" stroke="${brim}" stroke-width="5" stroke-linecap="round"/><text x="222" y="163" text-anchor="middle" fill="${brim === "#171715" ? "#f5f4ee" : "#171715"}" font-family="Arial,sans-serif" font-size="12" font-weight="700">${label}</text>`
      };
      return `<svg class="${className}" viewBox="0 0 360 260" role="img" aria-label="${product.department}: ${product.name}">${drawings[product.type]}</svg>`;
    }

    function renderProducts() {
      const query = document.getElementById("product-search").value.trim().toLocaleLowerCase("es");
      const minPriceInput = document.getElementById("price-min");
      const maxPriceInput = document.getElementById("price-max");
      const minPrice = minPriceInput.value === "" ? null : Number(minPriceInput.value);
      const maxPrice = maxPriceInput.value === "" ? null : Number(maxPriceInput.value);
      const sortOrder = document.getElementById("sort-products").value;
      const invalidPriceRange = minPrice !== null && maxPrice !== null && minPrice > maxPrice;
      minPriceInput.setAttribute("aria-invalid", String(invalidPriceRange));
      maxPriceInput.setAttribute("aria-invalid", String(invalidPriceRange));
      let visibleProducts = products.filter(product => {
        const matchesCategory = product.department === activeFilter;
        const matchesQuery = `${product.name} ${product.department} ${product.category || ""} ${product.description}`.toLocaleLowerCase("es").includes(query);
        const matchesPrice = (minPrice === null || product.price >= minPrice) &&
          (maxPrice === null || product.price <= maxPrice);
        return matchesCategory && matchesQuery && matchesPrice;
      });
      if (invalidPriceRange) visibleProducts = [];
      if (sortOrder === "price-asc") visibleProducts.sort((a, b) => a.price - b.price);
      if (sortOrder === "price-desc") visibleProducts.sort((a, b) => b.price - a.price);
      if (sortOrder === "name") visibleProducts.sort((a, b) => a.name.localeCompare(b.name, "es"));
      const grid = document.getElementById("products-grid");
      document.getElementById("results-count").textContent = `${visibleProducts.length} ${visibleProducts.length === 1 ? "producto" : "productos"}`;
      if (!visibleProducts.length) {
        grid.innerHTML = `<div class="empty-state">${invalidPriceRange ? "El precio mínimo no puede ser mayor al precio máximo." : "No encontramos productos con esos criterios. Prueba con otros filtros."}</div>`;
        return;
      }
      grid.innerHTML = visibleProducts.map(product => `
        <article class="product-card">
          <div class="product-visual">
            ${product.tag ? `<span class="product-tag">${product.tag}</span>` : ""}
            <button class="favorite-button ${favorites.has(product.id) ? "is-favorite" : ""}" data-favorite="${product.id}" aria-label="${favorites.has(product.id) ? "Quitar de favoritos" : "Añadir a favoritos"}" aria-pressed="${favorites.has(product.id)}">
              <svg viewBox="0 0 24 24" fill="${favorites.has(product.id) ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.7"><path d="M20.8 8.8c0 4.1-8.8 10.1-8.8 10.1S3.2 12.9 3.2 8.8A4.3 4.3 0 0 1 12 6.7a4.3 4.3 0 0 1 8.8 2.1Z"/></svg>
            </button>
            ${productArt(product)}
            <button class="quick-add" data-add="${product.id}">Agregar al carrito
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
          <div class="product-info">
            <div class="product-name-row"><h3 class="product-name">${product.name}</h3><span class="product-price">${formatPrice(product.price)}</span></div>
            <p class="product-description">${product.description}</p>
          </div>
        </article>`).join("");
    }

    function formatPrice(price) {
      return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(price);
    }

    function addToCart(id) {
      cart.set(id, (cart.get(id) || 0) + 1);
      renderCart();
      const product = products.find(item => item.id === id);
      showToast(`${product.name} agregada a tu carrito`);
    }

    function renderCart() {
      const count = [...cart.values()].reduce((sum, quantity) => sum + quantity, 0);
      const total = [...cart.entries()].reduce((sum, [id, quantity]) => sum + products.find(item => item.id === id).price * quantity, 0);
      try {
        localStorage.setItem("capstreet-cart", JSON.stringify([...cart.entries()]));
      } catch (error) {
        console.error("No se pudo guardar el carrito en este navegador.", error);
      }
      document.getElementById("cart-count").textContent = count;
      document.getElementById("drawer-count").textContent = `(${count})`;
      document.getElementById("cart-total").textContent = `${formatPrice(total)} MXN`;
      document.getElementById("checkout-button").disabled = count === 0;
      const items = document.getElementById("cart-items");
      if (count === 0) {
        items.innerHTML = '<div class="cart-empty">Tu carrito está esperando algo bueno.<br>Encuentra tu próxima gorra favorita.</div>';
        return;
      }
      items.innerHTML = [...cart.entries()].map(([id, quantity]) => {
        const product = products.find(item => item.id === id);
        return `<div class="cart-item">
          <div class="cart-item-art">${productArt(product, "")}</div>
          <div>
            <p class="cart-item-name">${product.name}</p>
            <span class="cart-item-price">${formatPrice(product.price)}</span>
            <div class="quantity-control">
              <button data-quantity="${id}" data-change="-1" aria-label="Quitar una ${product.name}">−</button>
              <span>${quantity}</span>
              <button data-quantity="${id}" data-change="1" aria-label="Añadir una ${product.name}">+</button>
            </div>
          </div>
          <button class="remove-button" data-remove="${id}">Quitar</button>
        </div>`;
      }).join("");
    }

    function showToast(message) {
      const toast = document.getElementById("toast");
      document.getElementById("toast-message").textContent = message;
      toast.classList.add("visible");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("visible"), 2300);
    }

    function setCartOpen(isOpen) {
      document.getElementById("cart-drawer").classList.toggle("open", isOpen);
      document.getElementById("cart-drawer").setAttribute("aria-hidden", String(!isOpen));
      document.getElementById("overlay").classList.toggle("open", isOpen);
      document.body.style.overflow = isOpen ? "hidden" : "";
    }

    document.getElementById("products-grid").addEventListener("click", event => {
      const addButton = event.target.closest("[data-add]");
      if (addButton) addToCart(Number(addButton.dataset.add));
      const favoriteButton = event.target.closest("[data-favorite]");
      if (favoriteButton) {
        const id = Number(favoriteButton.dataset.favorite);
        favorites.has(id) ? favorites.delete(id) : favorites.add(id);
        renderProducts();
      }
    });

    document.querySelector(".filters").addEventListener("click", event => {
      const button = event.target.closest("[data-department]");
      if (!button) return;
      activeFilter = button.dataset.department;
      const descriptions = {
        Gorras: "Diseños esenciales para completar tu estilo.",
        Ropa: "Prendas cómodas con actitud para todos los días.",
        "Joyería": "Detalles que elevan cualquier combinación.",
        Tenis: "Comodidad y estilo para moverte por la ciudad."
      };
      document.getElementById("collection-title").textContent = activeFilter;
      document.getElementById("collection-description").textContent = descriptions[activeFilter];
      document.querySelectorAll(".filter-button").forEach(filterButton => {
        const isActive = filterButton === button;
        filterButton.classList.toggle("active", isActive);
        filterButton.setAttribute("aria-pressed", String(isActive));
      });
      renderProducts();
    });

    document.getElementById("product-search").addEventListener("input", renderProducts);
    document.getElementById("price-min").addEventListener("input", renderProducts);
    document.getElementById("price-max").addEventListener("input", renderProducts);
    document.getElementById("sort-products").addEventListener("change", renderProducts);
    document.getElementById("clear-filters").addEventListener("click", () => {
      document.getElementById("product-search").value = "";
      document.getElementById("price-min").value = "";
      document.getElementById("price-max").value = "";
      document.getElementById("sort-products").value = "featured";
      renderProducts();
    });
    document.getElementById("search-focus").addEventListener("click", event => {
      const tools = document.getElementById("shop-tools");
      const isOpening = tools.hidden;
      tools.hidden = !isOpening;
      event.currentTarget.setAttribute("aria-expanded", String(isOpening));
      event.currentTarget.setAttribute("aria-label", isOpening ? "Ocultar búsqueda y filtros" : "Mostrar búsqueda y filtros");
      if (isOpening) {
        document.getElementById("coleccion").scrollIntoView({ behavior: "smooth" });
        setTimeout(() => document.getElementById("product-search").focus(), 350);
      }
    });
    document.getElementById("open-cart").addEventListener("click", () => setCartOpen(true));
    document.getElementById("close-cart").addEventListener("click", () => setCartOpen(false));
    document.getElementById("overlay").addEventListener("click", () => setCartOpen(false));
    function setAccountMode(mode) {
      accountMode = mode;
      const isLogin = mode === "login";
      const registrationFields = [
        ["account-name-field", "account-name"],
        ["account-address-field", "account-street"],
        ["account-exterior-field", "account-exterior"],
        ["account-interior-field", "account-interior"],
        ["account-neighborhood-field", "account-neighborhood"],
        ["account-postal-field", "account-postal"],
        ["account-city-field", "account-city"],
        ["account-state-field", "account-state"],
        ["account-phone-field", "account-phone"]
      ];
      registrationFields.forEach(([elementId, inputId]) => {
        const element = document.getElementById(elementId);
        const input = document.getElementById(inputId);
        element.hidden = isLogin;
        input.required = !isLogin && inputId !== "account-interior";
      });
      const consentField = document.getElementById("privacy-consent-field");
      const consentInput = document.getElementById("privacy-consent");
      consentField.hidden = isLogin;
      consentInput.required = !isLogin;
      document.getElementById("account-title").textContent = isLogin ? "Qué bueno verte." : "Únete al street.";
      document.getElementById("account-intro").textContent = isLogin
        ? "Inicia sesión para guardar tus favoritos y tener todo tu estilo en un solo lugar."
        : "Crea tu cuenta, verifica tu correo y guarda tu dirección para tus pedidos.";
      document.getElementById("account-submit").innerHTML = `${isLogin ? "Entrar" : "Crear cuenta"}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>`;
      document.getElementById("account-password").autocomplete = isLogin ? "current-password" : "new-password";
      document.getElementById("login-tab").classList.toggle("active", isLogin);
      document.getElementById("register-tab").classList.toggle("active", !isLogin);
      document.getElementById("login-tab").setAttribute("aria-selected", String(isLogin));
      document.getElementById("register-tab").setAttribute("aria-selected", String(!isLogin));
      document.getElementById("account-message").textContent = "";
      document.getElementById("account-form-panel").hidden = false;
      document.getElementById("account-verification").hidden = true;
    }

    function renderAccount() {
      const isSignedIn = Boolean(accountEmail);
      document.getElementById("account-form-panel").hidden = isSignedIn;
      document.getElementById("account-success").hidden = !isSignedIn;
      document.getElementById("account-verification").hidden = true;
      document.getElementById("account-label").textContent = isSignedIn ? "Mi perfil" : "Mi cuenta";
      document.getElementById("open-account").setAttribute("aria-label", isSignedIn ? "Ver perfil" : "Iniciar sesión");
      if (isSignedIn) {
        document.getElementById("account-success-title").textContent = "Tu cuenta está activa.";
        document.getElementById("account-success-description").textContent = `Sesión iniciada como ${accountEmail}. La sesión se conserva en este navegador.`;
        const address = accountProfile && [
          accountProfile.street,
          accountProfile.exterior_number && `#${accountProfile.exterior_number}`,
          accountProfile.interior_number && `Int. ${accountProfile.interior_number}`,
          accountProfile.neighborhood,
          accountProfile.postal_code,
          accountProfile.city,
          accountProfile.state
        ].filter(Boolean).join(", ");
        document.getElementById("account-profile-address").textContent = address
          ? `Dirección guardada: ${address}`
          : "Todavía no hay una dirección guardada en tu perfil.";
        loadAccountOrders();
      }
    }

    function setCheckoutPending(pending) {
      checkoutPending = pending;
      if (pending) localStorage.setItem(CHECKOUT_PENDING_KEY, "true");
      else localStorage.removeItem(CHECKOUT_PENDING_KEY);
    }

    function renderOrderMessage(container, message, className) {
      const paragraph = document.createElement("p");
      paragraph.className = className;
      paragraph.textContent = message;
      container.replaceChildren(paragraph);
    }

    async function loadAccountOrders() {
      const container = document.getElementById("account-orders");
      if (!supabaseClient || !accountEmail) {
        renderOrderMessage(container, "Inicia sesión para ver tus pedidos.", "order-empty");
        return;
      }

      const { data, error } = await supabaseClient
        .from("orders")
        .select("id,amount,currency,status,created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) {
        console.error("No se pudieron cargar los pedidos de la cuenta.", error);
        renderOrderMessage(container, "No se pudieron cargar tus pedidos. Intenta de nuevo.", "order-error");
        return;
      }
      if (!data.length) {
        renderOrderMessage(container, "Tus compras pagadas aparecerán aquí.", "order-empty");
        return;
      }

      const statuses = {
        pending: "Pago pendiente",
        paid: "Pagado",
        failed: "Pago fallido",
        cancelled: "Cancelado"
      };
      const list = document.createElement("div");
      list.className = "order-list";
      data.forEach(order => {
        const row = document.createElement("div");
        row.className = "order-entry";
        const label = document.createElement("span");
        const date = new Date(order.created_at).toLocaleDateString("es-MX");
        label.textContent = `Pedido ${order.id.slice(0, 8).toUpperCase()} · ${date} · ${statuses[order.status] || "En proceso"}`;
        const amount = document.createElement("span");
        amount.textContent = new Intl.NumberFormat("es-MX", {
          style: "currency",
          currency: order.currency.toUpperCase()
        }).format(order.amount / 100);
        row.append(label, amount);
        list.append(row);
      });
      container.replaceChildren(list);
    }

    function setAccountOpen(isOpen) {
      const overlay = document.getElementById("account-overlay");
      if (isOpen) {
        setCartOpen(false);
        accountPreviousFocus = document.activeElement;
        renderAccount();
        overlay.classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => {
          const target = accountEmail ? document.getElementById("logout-button") : document.getElementById("account-email");
          target.focus();
        }, 30);
      } else {
        overlay.classList.remove("open");
        document.body.style.overflow = "";
        if (accountPreviousFocus && typeof accountPreviousFocus.focus === "function") accountPreviousFocus.focus();
      }
    }

    document.getElementById("open-account").addEventListener("click", () => setAccountOpen(true));
    document.getElementById("close-account").addEventListener("click", () => setAccountOpen(false));
    document.getElementById("account-overlay").addEventListener("click", event => {
      if (event.target === event.currentTarget) setAccountOpen(false);
    });
    document.getElementById("login-tab").addEventListener("click", () => setAccountMode("login"));
    document.getElementById("register-tab").addEventListener("click", () => setAccountMode("register"));
    document.getElementById("verification-back").addEventListener("click", () => setAccountMode("login"));
    document.getElementById("toggle-password").addEventListener("click", event => {
      const password = document.getElementById("account-password");
      const isVisible = password.type === "text";
      password.type = isVisible ? "password" : "text";
      event.currentTarget.textContent = isVisible ? "Mostrar" : "Ocultar";
      event.currentTarget.setAttribute("aria-label", isVisible ? "Mostrar contraseña" : "Ocultar contraseña");
    });
    function showAccountMessage(message, isError = true) {
      const element = document.getElementById("account-message");
      element.textContent = message;
      element.style.color = isError ? "#b42318" : "#355000";
    }

    function getAuthErrorMessage(error) {
      const errorText = `${error.code || ""} ${error.message || ""}`.toLowerCase();
      if (errorText.includes("email_not_confirmed")) return "Primero confirma tu correo con el enlace que te enviamos.";
      if (errorText.includes("invalid_credentials")) return "Correo o contraseña incorrectos. Si acabas de registrarte, confirma tu correo.";
      if (errorText.includes("user_already_exists")) return "Ya existe una cuenta con ese correo. Intenta iniciar sesión.";
      if (errorText.includes("password") && errorText.includes("least")) return "La contraseña no cumple los requisitos. Usa al menos 6 caracteres.";
      return error.message || "No se pudo completar la solicitud. Intenta de nuevo.";
    }

    async function saveAccountProfile(user) {
      const { data: existingProfile, error: lookupError } = await supabaseClient
        .from("user_profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (existingProfile) {
        accountProfile = existingProfile;
        return;
      }

      const metadata = user.user_metadata || {};
      const profile = {
        id: user.id,
        full_name: metadata.full_name || "",
        street: metadata.street || "",
        exterior_number: metadata.exterior_number || "",
        interior_number: metadata.interior_number || "",
        neighborhood: metadata.neighborhood || "",
        postal_code: metadata.postal_code || "",
        city: metadata.city || "",
        state: metadata.state || "",
        phone: metadata.phone || "",
        privacy_policy_version: metadata.privacy_policy_version || "",
        privacy_consent_at: metadata.privacy_consent_at || null
      };
      const { data, error } = await supabaseClient
        .from("user_profiles")
        .upsert(profile, { onConflict: "id" })
        .select()
        .single();
      if (error) throw error;
      accountProfile = data;
    }

    function showVerification(email) {
      document.getElementById("account-form-panel").hidden = true;
      document.getElementById("account-success").hidden = true;
      document.getElementById("account-verification").hidden = false;
      document.getElementById("verification-message").textContent = "";
      document.getElementById("verification-email").textContent = `Enviamos un enlace de confirmación a ${email}. Si no lo ves, revisa la carpeta de spam.`;
      document.getElementById("close-account").focus();
    }

    document.getElementById("verification-resend").addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      const message = document.getElementById("verification-message");
      try {
        const { error } = await supabaseClient.auth.resend({
          type: "signup",
          email: document.getElementById("account-email").value.trim()
        });
        if (error) throw error;
        message.style.color = "#355000";
        message.textContent = "Listo, enviamos otro enlace de confirmación.";
      } catch (error) {
        message.style.color = "#b42318";
        message.textContent = getAuthErrorMessage(error);
      } finally {
        button.disabled = false;
      }
    });

    document.getElementById("account-form").addEventListener("submit", async event => {
      event.preventDefault();
      if (accountBusy) return;
      if (!supabaseClient) {
        showAccountMessage("No se pudo cargar el servicio de cuentas. Comprueba tu conexión e inténtalo de nuevo.");
        return;
      }

      const email = document.getElementById("account-email").value.trim();
      const password = document.getElementById("account-password").value;
      const submitButton = document.getElementById("account-submit");
      accountBusy = true;
      submitButton.disabled = true;
      showAccountMessage(accountMode === "register" ? "Creando tu cuenta..." : "Iniciando sesión...", false);

      try {
        if (accountMode === "register") {
          if (window.location.protocol === "file:") {
            showAccountMessage("Para verificar el correo necesitas abrir CAPSTREET desde http://localhost o desde tu dominio publicado, y permitir esa URL en Supabase.");
            return;
          }
          const fullName = document.getElementById("account-name").value.trim();
          const address = {
            street: document.getElementById("account-street").value.trim(),
            exterior_number: document.getElementById("account-exterior").value.trim(),
            interior_number: document.getElementById("account-interior").value.trim(),
            neighborhood: document.getElementById("account-neighborhood").value.trim(),
            postal_code: document.getElementById("account-postal").value.trim(),
            city: document.getElementById("account-city").value.trim(),
            state: document.getElementById("account-state").value.trim(),
            phone: document.getElementById("account-phone").value.trim()
          };
          const redirectUrl = `${window.location.origin}${window.location.pathname}`;
          const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: redirectUrl,
              data: {
                full_name: fullName,
                ...address,
                privacy_policy_version: "2026-11-04",
                privacy_consent_at: new Date().toISOString()
              }
            }
          });
          if (error) throw error;
          document.getElementById("account-password").value = "";
          if (!data.session) {
            showVerification(email);
            return;
          }
          await saveAccountProfile(data.user);
          accountEmail = data.user.email || email;
          renderAccount();
          setAccountOpen(false);
          await handleCheckoutReturn();
          await continueCheckoutAfterAccount();
        } else {
          const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
          if (error) throw error;
          await saveAccountProfile(data.user);
          accountEmail = data.user.email || email;
          document.getElementById("account-password").value = "";
          renderAccount();
          setAccountOpen(false);
          await handleCheckoutReturn();
          await continueCheckoutAfterAccount();
        }
      } catch (error) {
        showAccountMessage(getAuthErrorMessage(error));
      } finally {
        accountBusy = false;
        submitButton.disabled = false;
      }
    });
    document.getElementById("logout-button").addEventListener("click", async () => {
      if (!supabaseClient) return;
      const { error } = await supabaseClient.auth.signOut();
      if (error) {
        document.getElementById("account-success-description").textContent = getAuthErrorMessage(error);
        return;
      }
      accountEmail = "";
      accountProfile = null;
      setCheckoutPending(false);
      document.getElementById("account-form").reset();
      document.getElementById("account-password").type = "password";
      document.getElementById("toggle-password").textContent = "Mostrar";
      setAccountMode("login");
      renderAccount();
      document.getElementById("account-email").focus();
    });

    if (supabaseClient) {
      supabaseClient.auth.getSession().then(async ({ data, error }) => {
        if (error) {
          showAccountMessage(getAuthErrorMessage(error));
          return;
        }
        const user = data.session?.user;
        accountEmail = user?.email || "";
        if (user) {
          try {
            await saveAccountProfile(user);
          } catch (profileError) {
            accountProfile = null;
            showAccountMessage(`La sesión se restauró, pero no se pudo cargar tu dirección: ${getAuthErrorMessage(profileError)}`);
          }
        }
        renderAccount();
        await handleCheckoutReturn();
        if (checkoutPending && user) await continueCheckoutAfterAccount();
      }).catch(error => showAccountMessage(getAuthErrorMessage(error)));
      supabaseClient.auth.onAuthStateChange((_event, session) => {
        accountEmail = session?.user.email || "";
        renderAccount();
      });
    }
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        if (document.getElementById("account-overlay").classList.contains("open")) setAccountOpen(false);
        else setCartOpen(false);
      }
    });

    document.getElementById("cart-items").addEventListener("click", event => {
      const quantityButton = event.target.closest("[data-quantity]");
      const removeButton = event.target.closest("[data-remove]");
      if (removeButton) {
        cart.delete(Number(removeButton.dataset.remove));
        renderCart();
      } else if (quantityButton) {
        const id = Number(quantityButton.dataset.quantity);
        const nextQuantity = (cart.get(id) || 0) + Number(quantityButton.dataset.change);
        if (nextQuantity > 0) cart.set(id, nextQuantity);
        else cart.delete(id);
        renderCart();
      }
    });

    async function continueCheckoutAfterAccount() {
      if (!checkoutPending) return;
      await startCheckout();
    }

    async function startCheckout() {
      if (!cart.size) return;
      if (checkoutBusy) return;
      if (!supabaseClient) {
        setCheckoutPending(true);
        setAccountMode("register");
        setAccountOpen(true);
        showAccountMessage("No pudimos conectar con el servicio de cuentas. Comprueba tu conexión e inténtalo de nuevo.");
        return;
      }

      const button = document.getElementById("checkout-button");
      const originalLabel = button.innerHTML;
      checkoutBusy = true;
      button.disabled = true;
      button.textContent = "Conectando con Stripe...";
      try {
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        if (!data.session) {
          setCheckoutPending(true);
          setAccountMode("register");
          setAccountOpen(true);
          showAccountMessage("Crea tu cuenta o inicia sesión para continuar con tu compra. Tu carrito se conservará.");
          return;
        }
        if (!data.session.user.email_confirmed_at && !data.session.user.confirmed_at) {
          setCheckoutPending(true);
          setAccountMode("login");
          setAccountOpen(true);
          showAccountMessage("Confirma tu correo para continuar con la compra.");
          return;
        }

        setCheckoutPending(false);
        const response = await fetch(`${CHECKOUT_API_URL}/api/create-checkout-session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${data.session.access_token}`
          },
          body: JSON.stringify({ items: [...cart.entries()].map(([id, quantity]) => ({ id, quantity })) })
        });
        const result = await response.json();
        if (!response.ok) {
          if (response.status === 401) {
            setCheckoutPending(true);
            setAccountMode("login");
            setAccountOpen(true);
          }
          throw new Error(result.error || "No pudimos iniciar el pago.");
        }
        if (typeof result.checkoutUrl !== "string") {
          throw new Error("La pasarela no devolvió un enlace de pago válido.");
        }
        const checkoutUrl = new URL(result.checkoutUrl);
        if (checkoutUrl.protocol !== "https:" || !checkoutUrl.hostname.endsWith(".stripe.com")) {
          throw new Error("La pasarela devolvió una dirección de pago no válida.");
        }
        window.location.assign(checkoutUrl.href);
      } catch (error) {
        const message = error instanceof TypeError
          ? "No se pudo conectar con el servicio de pago. Verifica que la API de Render esté activa."
          : error.message;
        showToast(message);
        console.error("No se pudo completar el inicio de checkout.", error);
      } finally {
        checkoutBusy = false;
        button.disabled = cart.size === 0;
        button.innerHTML = originalLabel;
      }
    }

    async function handleCheckoutReturn() {
      const url = new URL(window.location.href);
      const checkoutState = url.searchParams.get("checkout");
      if (checkoutState === "cancel") {
        showToast("Pago cancelado. Tu carrito sigue guardado.");
        url.searchParams.delete("checkout");
        window.history.replaceState({}, "", url);
        return;
      }
      if (checkoutState !== "success") return;
      const sessionId = url.searchParams.get("session_id");
      if (!sessionId || !supabaseClient) {
        showToast("Inicia sesión para verificar el estado de tu pago.");
        return;
      }

      try {
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        if (!data.session) {
          setCheckoutPending(false);
          setAccountMode("login");
          setAccountOpen(true);
          showAccountMessage("Inicia sesión con la cuenta usada para pagar y verificaremos el pedido.");
          return;
        }
        const response = await fetch(`${CHECKOUT_API_URL}/api/checkout-session/${encodeURIComponent(sessionId)}`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` }
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "No pudimos verificar el pago.");
        if (result.paymentStatus === "paid" && result.order.status === "paid") {
          cart.clear();
          renderCart();
          showToast("¡Compra confirmada! Consulta el seguimiento en Mi cuenta.");
          await loadAccountOrders();
        } else {
          showToast("El pago aún no aparece como completado. Tu carrito sigue guardado.");
        }
        url.searchParams.delete("checkout");
        url.searchParams.delete("session_id");
        window.history.replaceState({}, "", url);
      } catch (error) {
        showToast(error.message || "No pudimos verificar tu pago.");
        console.error("No se pudo verificar el resultado del checkout.", error);
      }
    }

    document.getElementById("checkout-button").addEventListener("click", startCheckout);

    renderProducts();
    renderCart();
