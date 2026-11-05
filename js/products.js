const CAPSTREET_PRODUCTS = [
  { id: 1, department: "Gorras", category: "Clásicas", type: "cap", name: "La Clásica", description: "Negro / Ajuste clásico", price: 549, tag: "Favorita", color: "#171715", brim: "#292925", patch: "#d7f45b", label: "CAPSTREET" },
  { id: 2, department: "Gorras", category: "Clásicas", type: "cap", name: "Día Blanco", description: "Blanco hueso / Ajuste clásico", price: 549, tag: "Nuevo", color: "#f5f4ee", brim: "#d7d6cf", patch: "#171715", label: "S." },
  { id: 3, department: "Gorras", category: "Urbanas", type: "cap", name: "CAPSTREET Club", description: "Negro lavado / Fit relajado", price: 629, tag: "", color: "#393936", brim: "#252523", patch: "#efeee8", label: "CC" },
  { id: 4, department: "Gorras", category: "Edición especial", type: "cap", name: "Contraste", description: "Paneles bicolor / Edición limitada", price: 699, tag: "Edición limitada", color: "#f3f2ec", brim: "#171715", patch: "#171715", label: "01" },
  { id: 5, department: "Gorras", category: "Urbanas", type: "cap", name: "Noche Larga", description: "Negro total / Visera curva", price: 599, tag: "", color: "#20201e", brim: "#131312", patch: "#f5f4ee", label: "NOCHE" },
  { id: 6, department: "Gorras", category: "Clásicas", type: "cap", name: "Sin Prisa", description: "Gris piedra / Algodón suave", price: 579, tag: "Nuevo", color: "#b9b8b1", brim: "#92918a", patch: "#171715", label: "SP" },
  { id: 7, department: "Gorras", category: "Edición especial", type: "cap", name: "Fuera de Serie", description: "Negro / Bordado tonal", price: 749, tag: "Edición limitada", color: "#171715", brim: "#343430", patch: "#d7f45b", label: "FS" },
  { id: 8, department: "Gorras", category: "Urbanas", type: "cap", name: "Doble Tono", description: "Blanco y negro / Fit relajado", price: 649, tag: "", color: "#f5f4ee", brim: "#292926", patch: "#171715", label: "D/T" },
  { id: 9, department: "Ropa", type: "shirt", name: "Playera Street", description: "Algodón pesado / Negro", price: 699, tag: "Más vendido", color: "#171715", brim: "#d7f45b", label: "CAPSTREET" },
  { id: 10, department: "Ropa", type: "hoodie", name: "Hoodie Block", description: "Felpa suave / Gris jaspe", price: 1199, tag: "Nuevo", color: "#a9a8a1", brim: "#171715", label: "C." },
  { id: 11, department: "Ropa", type: "shirt", name: "Playera Essential", description: "Corte relajado / Blanco", price: 649, tag: "", color: "#f5f4ee", brim: "#171715", label: "CS" },
  { id: 12, department: "Ropa", type: "hoodie", name: "Hoodie Midnight", description: "Oversize / Negro", price: 1299, tag: "", color: "#252523", brim: "#d7f45b", label: "STREET" },
  { id: 13, department: "Joyería", type: "chain", name: "Cadena Link", description: "Acero inoxidable / Plateado", price: 799, tag: "Acero inoxidable", color: "#c5c3ba", brim: "#8d8a80", label: "CS" },
  { id: 14, department: "Joyería", type: "bracelet", name: "Pulsera Core", description: "Acero pulido / Ajustable", price: 499, tag: "", color: "#b6b3a9", brim: "#77746b", label: "C" },
  { id: 15, department: "Joyería", type: "chain", name: "Cadena Bold", description: "Eslabón grueso / Acero", price: 999, tag: "Nuevo", color: "#d6d3c8", brim: "#88857c", label: "CAP" },
  { id: 16, department: "Joyería", type: "bracelet", name: "Brazalete Mono", description: "Acabado negro / Minimalista", price: 599, tag: "", color: "#30302d", brim: "#171715", label: "C" },
  { id: 17, department: "Tenis", type: "sneaker", name: "Court Low", description: "Blanco y negro / Uso diario", price: 1499, tag: "Favoritos", color: "#f5f4ee", brim: "#171715", label: "CS" },
  { id: 18, department: "Tenis", type: "sneaker", name: "Runner Mono", description: "Negro total / Suela cómoda", price: 1699, tag: "Nuevo", color: "#252523", brim: "#d7f45b", label: "C" },
  { id: 19, department: "Tenis", type: "sneaker", name: "Court Contrast", description: "Diseño bicolor / Silueta clásica", price: 1599, tag: "", color: "#e8e7df", brim: "#171715", label: "ST" },
  { id: 20, department: "Tenis", type: "sneaker", name: "Street High", description: "Caña alta / Negro y blanco", price: 1799, tag: "", color: "#171715", brim: "#f5f4ee", label: "CS" }
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = CAPSTREET_PRODUCTS;
} else if (typeof window !== "undefined") {
  window.CAPSTREET_PRODUCTS = CAPSTREET_PRODUCTS;
}
