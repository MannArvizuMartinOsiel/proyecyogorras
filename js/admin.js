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
  Perfumes: [["perfume", "Perfume"]],
  Joyería: [["chain", "Cadena"], ["bracelet", "Pulsera"]],
  Tenis: [["sneaker", "Tenis"]]
};
const adminCategoryOptions = [
  ["Gorras", "Gorras"],
  ["Ropa", "Ropa"],
  ["Tenis", "Calzado"],
  ["Joyería", "Joyería"],
  ["Perfumes", "Perfumes"]
];
const loginForm = document.getElementById("admin-login-form");
const loginMessage = document.getElementById("admin-login-message");
const loginSection = document.getElementById("admin-login");
const dashboard = document.getElementById("admin-dashboard");
let adminProductCache = [];
let editingProduct = null;
let removeExistingImage = false;
let adminCategoryImageCache = {};
const pendingCategoryImages = new Map();
const categoryImagePreviewUrls = new Map();

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

function renderProducts(items, { readOnly = false } = {}) {
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
    editButton.disabled = readOnly;
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "admin-delete-product";
    deleteButton.dataset.deleteProduct = product.id;
    deleteButton.textContent = "Quitar";
    deleteButton.disabled = readOnly;
    if (readOnly) {
      editButton.title = "Ejecuta primero la migración de Supabase.";
      deleteButton.title = "Ejecuta primero la migración de Supabase.";
    }
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
  const readOnly = result.source === "bundled";
  renderProducts(result.products, { readOnly });
  setProductFormReadOnly(readOnly);
  document.getElementById("admin-catalog-message").textContent = result.warning || "";
}

function setProductFormReadOnly(readOnly) {
  const form = document.getElementById("admin-product-form");
  form.querySelectorAll("input, select, textarea, button").forEach(control => {
    control.disabled = readOnly;
  });
  document.getElementById("product-cancel-edit").disabled = false;
}

function renderCategoryImages() {
  for (const previewUrl of categoryImagePreviewUrls.values()) URL.revokeObjectURL(previewUrl);
  categoryImagePreviewUrls.clear();
  pendingCategoryImages.clear();
  const container = document.getElementById("admin-category-image-list");
  container.replaceChildren(...adminCategoryOptions.map(([department, label]) => {
    const card = document.createElement("article");
    card.className = "admin-category-image-card";
    const heading = document.createElement("h4");
    heading.textContent = label;
    const preview = document.createElement("div");
    preview.className = "admin-category-image-preview";
    const image = document.createElement("img");
    image.alt = `Imagen de la categoría ${label}`;
    image.hidden = !adminCategoryImageCache[department];
    if (adminCategoryImageCache[department]) image.src = adminCategoryImageCache[department];
    const placeholder = document.createElement("span");
    placeholder.textContent = "Se usan las ilustraciones de productos";
    placeholder.hidden = Boolean(adminCategoryImageCache[department]);
    preview.append(image, placeholder);
    const labelElement = document.createElement("label");
    labelElement.textContent = "Cambiar imagen";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.dataset.categoryImageFile = department;
    labelElement.append(input);
    const actions = document.createElement("div");
    actions.className = "admin-category-image-actions";
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "button";
    saveButton.dataset.saveCategoryImage = department;
    saveButton.textContent = "Guardar imagen";
    saveButton.disabled = true;
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "admin-cancel-edit";
    removeButton.dataset.removeCategoryImage = department;
    removeButton.textContent = "Quitar imagen";
    removeButton.disabled = !adminCategoryImageCache[department];
    actions.append(saveButton, removeButton);
    const message = document.createElement("p");
    message.className = "admin-category-image-message";
    message.dataset.categoryImageMessage = department;
    message.setAttribute("role", "status");
    card.append(heading, preview, labelElement, actions, message);
    return card;
  }));
}

async function loadAdminCategoryImages(session) {
  const result = await adminRequest("/api/admin/category-images", session);
  adminCategoryImageCache = result.images;
  renderCategoryImages();
}

function setCategoryImagesReadOnly(readOnly) {
  document.querySelectorAll("#admin-category-image-list input, #admin-category-image-list button")
    .forEach(control => { control.disabled = readOnly; });
}

async function showDashboard(session) {
  document.getElementById("admin-session-email").textContent = session.user.email;
  loginSection.hidden = true;
  dashboard.hidden = false;
  showLoginMessage("");
  const message = document.getElementById("admin-catalog-message");
  message.textContent = "";
  try {
    await loadAdminProducts(session);
    setCategoryImagesReadOnly(document.getElementById("product-save-button").disabled);
    try {
      await loadAdminCategoryImages(session);
      setCategoryImagesReadOnly(document.getElementById("product-save-button").disabled);
    } catch (error) {
      adminCategoryImageCache = {};
      renderCategoryImages();
      setCategoryImagesReadOnly(document.getElementById("product-save-button").disabled);
      document.getElementById("admin-category-images-message").textContent =
        `No se pudieron cargar las imágenes por categoría: ${error.message}`;
    }
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      dashboard.hidden = true;
      loginSection.hidden = false;
      showLoginMessage(error.message);
      return;
    }
    const bundledProducts = window.CAPSTREET_PRODUCTS;
    if (Array.isArray(bundledProducts) && bundledProducts.length) {
      renderProducts(bundledProducts, { readOnly: true });
      setProductFormReadOnly(true);
      adminCategoryImageCache = {};
      renderCategoryImages();
      setCategoryImagesReadOnly(true);
    }
    message.textContent = `El servidor no pudo cargar el catálogo: ${error.message}. Se muestran los productos originales en modo de solo lectura. Verifica la conexión de Supabase y vuelve a cargar el panel.`;
  }
  try {
    await loadAdminHeroVideo(session);
  } catch (error) {
    document.getElementById("admin-hero-video-message").textContent =
      `No se pudo cargar el video de portada: ${error.message}`;
  }
}

async function imageFileToDataUrl(file) {
  const imageBuffer = new Uint8Array(await file.arrayBuffer());
  const chunks = [];
  for (let offset = 0; offset < imageBuffer.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...imageBuffer.subarray(offset, offset + 0x8000)));
  }
  return `data:${file.type};base64,${btoa(chunks.join(""))}`;
}

function showImagePreview(source) {
  if (productImagePreviewUrl) {
    URL.revokeObjectURL(productImagePreviewUrl);
    productImagePreviewUrl = null;
  }
  productImagePreviewImg.src = source;
  productImagePreview.hidden = false;
}

const adminHeroVideoInput = document.getElementById("admin-hero-video-file");
const adminHeroVideoPreview = document.getElementById("admin-hero-video-preview");
const adminHeroVideoSaveButton = document.getElementById("admin-hero-video-save");
const adminHeroVideoRemoveButton = document.getElementById("admin-hero-video-remove");
let currentHeroVideoUrl = null;
let adminHeroVideoPreviewUrl = null;

function showAdminHeroVideoPreview(source, isTemporary = false) {
  if (adminHeroVideoPreviewUrl) {
    URL.revokeObjectURL(adminHeroVideoPreviewUrl);
    adminHeroVideoPreviewUrl = null;
  }
  adminHeroVideoPreview.pause();
  if (source) {
    adminHeroVideoPreview.src = source;
    adminHeroVideoPreview.hidden = false;
    if (isTemporary) adminHeroVideoPreviewUrl = source;
    adminHeroVideoPreview.load();
  } else {
    adminHeroVideoPreview.removeAttribute("src");
    adminHeroVideoPreview.hidden = true;
    adminHeroVideoPreview.load();
  }
  adminHeroVideoRemoveButton.disabled = !currentHeroVideoUrl;
}

async function loadAdminHeroVideo(session) {
  const result = await adminRequest("/api/hero-video", session);
  currentHeroVideoUrl = result.videoUrl || null;
  adminHeroVideoInput.value = "";
  adminHeroVideoSaveButton.disabled = true;
  showAdminHeroVideoPreview(currentHeroVideoUrl);
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

document.getElementById("admin-category-image-list").addEventListener("change", event => {
  const input = event.target.closest("[data-category-image-file]");
  if (!input) return;
  const department = input.dataset.categoryImageFile;
  const file = input.files[0];
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 4 * 1024 * 1024) {
    input.value = "";
    const oldPreviewUrl = categoryImagePreviewUrls.get(department);
    if (oldPreviewUrl) URL.revokeObjectURL(oldPreviewUrl);
    categoryImagePreviewUrls.delete(department);
    pendingCategoryImages.delete(department);
    const card = input.closest(".admin-category-image-card");
    const image = card.querySelector(".admin-category-image-preview img");
    const existingImage = adminCategoryImageCache[department];
    image.hidden = !existingImage;
    if (existingImage) image.src = existingImage;
    card.querySelector(".admin-category-image-preview span").hidden = Boolean(existingImage);
    card.querySelector("[data-save-category-image]").disabled = true;
    card.querySelector("[data-remove-category-image]").disabled = !existingImage;
    card.querySelector(".admin-category-image-message").textContent =
      "Elige una imagen JPG, PNG o WebP de máximo 4 MB.";
    return;
  }
  const oldPreviewUrl = categoryImagePreviewUrls.get(department);
  if (oldPreviewUrl) URL.revokeObjectURL(oldPreviewUrl);
  const previewUrl = URL.createObjectURL(file);
  categoryImagePreviewUrls.set(department, previewUrl);
  pendingCategoryImages.set(department, file);
  const card = input.closest(".admin-category-image-card");
  const image = card.querySelector(".admin-category-image-preview img");
  image.src = previewUrl;
  image.hidden = false;
  card.querySelector(".admin-category-image-preview span").hidden = true;
  card.querySelector("[data-save-category-image]").disabled = false;
  card.querySelector("[data-remove-category-image]").disabled = false;
  card.querySelector(".admin-category-image-message").textContent = "";
});

document.getElementById("admin-category-image-list").addEventListener("click", async event => {
  const saveButton = event.target.closest("[data-save-category-image]");
  const removeButton = event.target.closest("[data-remove-category-image]");
  if (!saveButton && !removeButton) return;
  const department = (saveButton || removeButton).dataset.saveCategoryImage ||
    (saveButton || removeButton).dataset.removeCategoryImage;
  const card = (saveButton || removeButton).closest(".admin-category-image-card");
  const message = card.querySelector(".admin-category-image-message");
  const selectedFile = pendingCategoryImages.get(department);

  if (removeButton && selectedFile) {
    const previewUrl = categoryImagePreviewUrls.get(department);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    categoryImagePreviewUrls.delete(department);
    pendingCategoryImages.delete(department);
    const input = card.querySelector("[data-category-image-file]");
    input.value = "";
    const image = card.querySelector(".admin-category-image-preview img");
    const existingImage = adminCategoryImageCache[department];
    image.hidden = !existingImage;
    if (existingImage) image.src = existingImage;
    card.querySelector(".admin-category-image-preview span").hidden = Boolean(existingImage);
    card.querySelector("[data-save-category-image]").disabled = true;
    card.querySelector("[data-remove-category-image]").disabled = !existingImage;
    message.textContent = "";
    return;
  }

  const button = saveButton || removeButton;
  setBusy(button, true, saveButton ? "Guardando..." : "Quitando...");
  message.textContent = "";
  try {
    const { data, error } = await adminSupabase.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error("Tu sesión terminó. Inicia sesión de nuevo.");
    if (saveButton) {
      if (!selectedFile) throw new Error("Selecciona una imagen antes de guardarla.");
      const result = await adminRequest(`/api/admin/category-images/${encodeURIComponent(department)}`, data.session, {
        method: "PUT",
        body: JSON.stringify({ imageData: await imageFileToDataUrl(selectedFile) })
      });
      adminCategoryImageCache[department] = result.imageUrl;
      renderCategoryImages();
      document.querySelector(`[data-category-image-message="${department}"]`).textContent =
        result.warning || "La imagen de categoría se actualizó.";
    } else {
      if (!adminCategoryImageCache[department]) return;
      if (!window.confirm(`¿Quitar la imagen personalizada de ${department}?`)) return;
      await adminRequest(`/api/admin/category-images/${encodeURIComponent(department)}`, data.session, {
        method: "DELETE"
      });
      delete adminCategoryImageCache[department];
      renderCategoryImages();
      document.querySelector(`[data-category-image-message="${department}"]`).textContent =
        "Se restauraron las ilustraciones de productos.";
    }
  } catch (error) {
    message.textContent = error.message || "No se pudo actualizar la imagen de categoría.";
  } finally {
    if (button.isConnected) setBusy(button, false);
  }
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

adminHeroVideoInput.addEventListener("change", () => {
  const file = adminHeroVideoInput.files[0];
  if (!file) {
    showAdminHeroVideoPreview(currentHeroVideoUrl);
    return;
  }
  if (!["video/mp4", "video/webm"].includes(file.type) || file.size > 20 * 1024 * 1024) {
    adminHeroVideoInput.value = "";
    showAdminHeroVideoPreview(currentHeroVideoUrl);
    document.getElementById("admin-hero-video-message").textContent =
      "Selecciona un video MP4 o WebM de máximo 20 MB.";
    return;
  }
  showAdminHeroVideoPreview(URL.createObjectURL(file), true);
  adminHeroVideoSaveButton.disabled = false;
  document.getElementById("admin-hero-video-message").textContent = "";
});

adminHeroVideoSaveButton.addEventListener("click", async () => {
  const file = adminHeroVideoInput.files[0];
  const message = document.getElementById("admin-hero-video-message");
  if (!file) return;
  setBusy(adminHeroVideoSaveButton, true, "Subiendo video...");
  message.textContent = "";
  try {
    const { data, error } = await adminSupabase.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error("Tu sesión terminó. Inicia sesión de nuevo.");
    const result = await adminRequest("/api/admin/hero-video", data.session, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file
    });
    currentHeroVideoUrl = result.videoUrl;
    adminHeroVideoInput.value = "";
    showAdminHeroVideoPreview(currentHeroVideoUrl);
    message.textContent = result.warning || "El video de portada se actualizó correctamente.";
  } catch (error) {
    message.textContent = error.message || "No pudimos guardar el video de portada.";
  } finally {
    setBusy(adminHeroVideoSaveButton, false);
    adminHeroVideoSaveButton.disabled = !adminHeroVideoInput.files.length;
  }
});

adminHeroVideoRemoveButton.addEventListener("click", async () => {
  if (!currentHeroVideoUrl || !window.confirm("¿Quitar el video? La portada volverá a mostrar la ilustración de la gorra.")) return;
  const message = document.getElementById("admin-hero-video-message");
  setBusy(adminHeroVideoRemoveButton, true, "Quitando video...");
  message.textContent = "";
  try {
    const { data, error } = await adminSupabase.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error("Tu sesión terminó. Inicia sesión de nuevo.");
    const result = await adminRequest("/api/admin/hero-video", data.session, { method: "DELETE" });
    currentHeroVideoUrl = null;
    adminHeroVideoInput.value = "";
    adminHeroVideoSaveButton.disabled = true;
    showAdminHeroVideoPreview(null);
    message.textContent = result.warning || "Se quitó el video. La portada volverá a mostrar la ilustración.";
  } catch (error) {
    message.textContent = error.message || "No pudimos quitar el video de portada.";
  } finally {
    setBusy(adminHeroVideoRemoveButton, false);
    adminHeroVideoRemoveButton.disabled = !currentHeroVideoUrl;
  }
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
      imageData = await imageFileToDataUrl(imageFile);
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
    message.textContent = result.warning
      ? `${productName}: ${result.warning}`
      : `${productName} ${action} correctamente.`;
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
