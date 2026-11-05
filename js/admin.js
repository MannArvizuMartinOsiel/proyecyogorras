const adminApiUrl = window.CAPSTREET_CONFIG.checkoutApiUrl.replace(/\/+$/, "");
const adminSupabase = window.supabase.createClient(
  window.CAPSTREET_CONFIG.supabaseUrl,
  window.CAPSTREET_CONFIG.supabaseAnonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      storageKey: "capstreet-supabase-auth"
    }
  }
);
const typeOptions = {
  Gorras: [["cap", "Gorra"]],
  Ropa: [["shirt", "Playera"], ["hoodie", "Sudadera"]],
  Joyería: [["chain", "Cadena"], ["bracelet", "Pulsera"]],
  Tenis: [["sneaker", "Tenis"]]
};
const loginForm = document.getElementById("admin-login-form");
const loginMessage = document.getElementById("admin-login-message");
const loginSection = document.getElementById("admin-login");
const dashboard = document.getElementById("admin-dashboard");
let adminProductCache = [];
let editingProduct = null;
let removeExistingImage = false;

function showLoginMessage(message) {
  loginMessage.textContent = message;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = label;
  } else if (button.dataset.originalLabel) {
    button.textContent = button.dataset.originalLabel;
    delete button.dataset.originalLabel;
  }
}

async function adminRequest(path, session, options = {}) {
  const response = await fetch(`${adminApiUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers
    }
  });
  const responseText = await response.text();
  let result;
  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    if (response.status === 404) {
      throw new Error(`No encontramos la API de administración en ${adminApiUrl}. Verifica el dominio del servicio Web en Render y que esté desplegado.`);
    }
    throw new Error(`La API de administración devolvió una respuesta no válida (HTTP ${response.status}).`);
  }
  if (response.status === 404) {
    throw new Error(`No encontramos la API de administración en ${adminApiUrl}. Verifica el dominio del servicio Web en Render y que esté desplegado.`);
  }
  if (!response.ok) {
    const error = new Error(result.error || "No se pudo completar la solicitud.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function renderProducts(items) {
  adminProductCache = items;
  const container = document.getElementById("admin-products");
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "Todavía no agregas artículos.";
    container.replaceChildren(empty);
    return;
  }
  const list = document.createElement("div");
  list.className = "admin-product-rows";
  items.forEach(product => {
    const row = document.createElement("article");
    row.className = "admin-product-row";
    const content = document.createElement("div");
    content.className = "admin-product-row-content";
    if (product.image_url) {
      const image = document.createElement("img");
      image.className = "admin-product-thumb";
      image.src = product.image_url;
      image.alt = `Imagen de ${product.name}`;
      image.loading = "lazy";
      content.append(image);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "admin-product-thumb";
      placeholder.setAttribute("aria-hidden", "true");
      content.append(placeholder);
    }
    const details = document.createElement("div");
    const heading = document.createElement("div");
    heading.className = "admin-product-row-head";
    const title = document.createElement("h4");
    title.textContent = product.name;
    const price = document.createElement("strong");
    price.textContent = new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 0
    }).format(product.price);
    heading.append(title, price);
    const meta = document.createElement("p");
    meta.className = "admin-product-meta";
    meta.textContent = `${product.department}${product.category ? ` · ${product.category}` : ""}`;
    const description = document.createElement("p");
    description.textContent = product.description;
    const actions = document.createElement("div");
    actions.className = "admin-product-row-actions";
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.dataset.editProduct = product.id;
    editButton.textContent = "Editar";
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "admin-delete-product";
    deleteButton.dataset.deleteProduct = product.id;
    deleteButton.textContent = "Quitar";
    actions.append(editButton, deleteButton);
    details.append(heading, meta, description, actions);
    content.append(details);
    row.append(content);
    list.append(row);
  });
  container.replaceChildren(list);
}

async function loadAdminProducts(session) {
  const result = await adminRequest("/api/admin/products", session);
  renderProducts(result.products);
}

async function showDashboard(session) {
  document.getElementById("admin-session-email").textContent = session.user.email;
  loginSection.hidden = true;
  dashboard.hidden = false;
  showLoginMessage("");
  const message = document.getElementById("admin-product-message");
  message.textContent = "";
  try {
    await loadAdminProducts(session);
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      dashboard.hidden = true;
      loginSection.hidden = false;
      showLoginMessage(error.message);
      return;
    }
    message.textContent = `La sesión es válida, pero no se pudo cargar el catálogo: ${error.message}`;
  }
}

function showImagePreview(source) {
  if (productImagePreviewUrl) {
    URL.revokeObjectURL(productImagePreviewUrl);
    productImagePreviewUrl = null;
  }
  productImagePreviewImg.src = source;
  productImagePreview.hidden = false;
}

function resetProductForm() {
  const form = document.getElementById("admin-product-form");
  form.reset();
  editingProduct = null;
  removeExistingImage = false;
  clearProductImage();
  document.getElementById("product-department").dispatchEvent(new Event("change"));
  document.getElementById("product-form-title").textContent = "Agregar artículo";
  document.getElementById("product-save-button").textContent = "Guardar artículo";
  document.getElementById("product-cancel-edit").hidden = true;
}

function beginProductEdit(product) {
  editingProduct = product;
  removeExistingImage = false;
  document.getElementById("product-form-title").textContent = `Editar: ${product.name}`;
  document.getElementById("product-name").value = product.name;
  document.getElementById("product-department").value = product.department;
  document.getElementById("product-department").dispatchEvent(new Event("change"));
  document.getElementById("product-type").value = product.type;
  document.getElementById("product-category").value = product.category || "";
  document.getElementById("product-price").value = product.price;
  document.getElementById("product-description").value = product.description;
  clearProductImage();
  if (product.image_url) showImagePreview(product.image_url);
  else {
    productImagePreview.hidden = true;
    productImagePreviewImg.removeAttribute("src");
  }
  document.getElementById("product-save-button").textContent = "Guardar cambios";
  document.getElementById("product-cancel-edit").hidden = false;
  document.getElementById("admin-product-message").textContent = "";
  document.getElementById("product-name").focus();
}

document.getElementById("product-department").addEventListener("change", event => {
  const typeSelect = document.getElementById("product-type");
  typeSelect.replaceChildren(...typeOptions[event.target.value].map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
});
document.getElementById("product-department").dispatchEvent(new Event("change"));

const productImageInput = document.getElementById("product-image");
const productImagePreview = document.getElementById("product-image-preview");
const productImagePreviewImg = document.getElementById("product-image-preview-img");
let productImagePreviewUrl = null;

function clearProductImage() {
  productImageInput.value = "";
  productImagePreview.hidden = true;
  productImagePreviewImg.removeAttribute("src");
  if (productImagePreviewUrl) {
    URL.revokeObjectURL(productImagePreviewUrl);
    productImagePreviewUrl = null;
  }
}

productImageInput.addEventListener("change", () => {
  const file = productImageInput.files[0];
  if (productImagePreviewUrl) URL.revokeObjectURL(productImagePreviewUrl);
  productImagePreviewUrl = null;
  if (!file) {
    if (editingProduct?.image_url && !removeExistingImage) showImagePreview(editingProduct.image_url);
    else {
      productImagePreview.hidden = true;
      productImagePreviewImg.removeAttribute("src");
    }
    return;
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 4 * 1024 * 1024) {
    clearProductImage();
    document.getElementById("admin-product-message").textContent =
      "Elige una imagen JPG, PNG o WebP de máximo 4 MB.";
    return;
  }
  removeExistingImage = false;
  productImagePreviewUrl = URL.createObjectURL(file);
  productImagePreviewImg.src = productImagePreviewUrl;
  productImagePreview.hidden = false;
  document.getElementById("admin-product-message").textContent = "";
});
document.getElementById("product-image-remove").addEventListener("click", () => {
  if (productImageInput.files.length) {
    productImageInput.value = "";
    if (editingProduct?.image_url && !removeExistingImage) showImagePreview(editingProduct.image_url);
    else {
      productImagePreview.hidden = true;
      productImagePreviewImg.removeAttribute("src");
    }
    return;
  }
  if (editingProduct?.image_url && !removeExistingImage) {
    removeExistingImage = true;
    productImagePreview.hidden = true;
    productImagePreviewImg.removeAttribute("src");
    document.getElementById("admin-product-message").textContent = "Se quitará la imagen al guardar los cambios.";
    return;
  }
  clearProductImage();
});

document.getElementById("admin-password-toggle").addEventListener("click", event => {
  const password = document.getElementById("admin-password");
  const isVisible = password.type === "text";
  password.type = isVisible ? "password" : "text";
  event.currentTarget.textContent = isVisible ? "Mostrar" : "Ocultar";
  event.currentTarget.setAttribute("aria-label", isVisible ? "Mostrar contraseña" : "Ocultar contraseña");
  event.currentTarget.setAttribute("aria-pressed", String(!isVisible));
});

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = document.getElementById("admin-login-button");
  setBusy(button, true, "Verificando...");
  showLoginMessage("");
  try {
    const { data, error } = await adminSupabase.auth.signInWithPassword({
      email: document.getElementById("admin-email").value.trim(),
      password: document.getElementById("admin-password").value
    });
    if (error) throw error;
    await showDashboard(data.session);
    document.getElementById("admin-password").value = "";
    document.getElementById("admin-password").type = "password";
    const passwordToggle = document.getElementById("admin-password-toggle");
    passwordToggle.textContent = "Mostrar";
    passwordToggle.setAttribute("aria-label", "Mostrar contraseña");
    passwordToggle.setAttribute("aria-pressed", "false");
  } catch (error) {
    showLoginMessage(error.message || "No pudimos iniciar sesión.");
  } finally {
    setBusy(button, false);
  }
});

document.getElementById("admin-product-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById("product-save-button");
  const message = document.getElementById("admin-product-message");
  setBusy(button, true, "Guardando...");
  message.textContent = "";
  try {
    const { data, error } = await adminSupabase.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error("Tu sesión terminó. Inicia sesión de nuevo.");
    const formData = new FormData(form);
    const imageFile = productImageInput.files[0];
    let imageData = null;
    if (imageFile) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(imageFile.type) || imageFile.size > 4 * 1024 * 1024) {
        throw new Error("Elige una imagen JPG, PNG o WebP de máximo 4 MB.");
      }
      const imageBuffer = new Uint8Array(await imageFile.arrayBuffer());
      const chunks = [];
      for (let offset = 0; offset < imageBuffer.length; offset += 0x8000) {
        chunks.push(String.fromCharCode(...imageBuffer.subarray(offset, offset + 0x8000)));
      }
      const binary = chunks.join("");
      imageData = `data:${imageFile.type};base64,${btoa(binary)}`;
    }
    const endpoint = editingProduct
      ? `/api/admin/products/${encodeURIComponent(editingProduct.id)}`
      : "/api/admin/products";
    const result = await adminRequest(endpoint, data.session, {
      method: editingProduct ? "PUT" : "POST",
      body: JSON.stringify({
        name: formData.get("name"),
        department: formData.get("department"),
        type: formData.get("type"),
        category: formData.get("category"),
        price: Number(formData.get("price")),
        description: formData.get("description"),
        imageData,
        removeImage: removeExistingImage
      })
    });
    const action = editingProduct ? "se actualizó" : "se agregó";
    const productName = result.product.name;
    setBusy(button, false);
    resetProductForm();
    message.textContent = `${productName} ${action} correctamente.`;
    try {
      await loadAdminProducts(data.session);
    } catch (error) {
      message.textContent = `${productName} se guardó, pero no se pudo actualizar la lista: ${error.message}`;
    }
  } catch (error) {
    message.textContent = error.message || "No pudimos guardar el artículo.";
  } finally {
    setBusy(button, false);
  }
});

document.getElementById("product-cancel-edit").addEventListener("click", resetProductForm);
document.getElementById("admin-products").addEventListener("click", async event => {
  const editButton = event.target.closest("[data-edit-product]");
  if (editButton) {
    const product = adminProductCache.find(item => item.id === Number(editButton.dataset.editProduct));
    if (product) beginProductEdit(product);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-product]");
  if (!deleteButton) return;
  const product = adminProductCache.find(item => item.id === Number(deleteButton.dataset.deleteProduct));
  if (!product || !window.confirm(`¿Quitar "${product.name}" del catálogo? Esta acción no se puede deshacer desde el panel.`)) return;

  const message = document.getElementById("admin-product-message");
  setBusy(deleteButton, true, "Quitando...");
  message.textContent = "";
  try {
    const { data, error } = await adminSupabase.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error("Tu sesión terminó. Inicia sesión de nuevo.");
    await adminRequest(`/api/admin/products/${encodeURIComponent(product.id)}`, data.session, {
      method: "DELETE"
    });
    if (editingProduct?.id === product.id) resetProductForm();
    message.textContent = `${product.name} se quitó del catálogo.`;
    try {
      await loadAdminProducts(data.session);
    } catch (error) {
      message.textContent = `${product.name} se quitó, pero no se pudo actualizar la lista: ${error.message}`;
    }
  } catch (error) {
    message.textContent = error.message || "No pudimos quitar el artículo.";
  } finally {
    setBusy(deleteButton, false);
  }
});

document.getElementById("admin-refresh").addEventListener("click", async event => {
  const button = event.currentTarget;
  setBusy(button, true, "Actualizando...");
  try {
    const { data, error } = await adminSupabase.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error("Tu sesión terminó. Inicia sesión de nuevo.");
    await loadAdminProducts(data.session);
  } catch (error) {
    document.getElementById("admin-product-message").textContent = error.message;
  } finally {
    setBusy(button, false);
  }
});

document.getElementById("admin-logout").addEventListener("click", async () => {
  const { error } = await adminSupabase.auth.signOut();
  if (error) {
    document.getElementById("admin-product-message").textContent = error.message;
    return;
  }
  dashboard.hidden = true;
  loginSection.hidden = false;
  showLoginMessage("");
});

adminSupabase.auth.getSession().then(({ data, error }) => {
  if (error) {
    showLoginMessage(error.message);
    return;
  }
  if (data.session) showDashboard(data.session);
}).catch(error => showLoginMessage(error.message || "No pudimos restaurar la sesión."));
