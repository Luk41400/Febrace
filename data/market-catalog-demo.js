// Catálogo inteiramente fictício para desenvolvimento/teste. Nenhuma oferta é real.
const examples = [
  ["Caderno Universitário 10 Matérias 200 Folhas", "Capa dura para estudos", "caderno", 34.90, "Papelaria Modelo"],
  ["Caderno Universitário Espiral 96 Folhas", "Capa flexível para escola", "caderno", 18.50, "Loja Alfa Exemplo"],
  ["Caderno Brochura Escolar 80 Folhas", "Pautado para anotações", "caderno", 12.90, "Papelaria Modelo"],
  ["Caderno de Desenho A4 100 Folhas", "Papel sem pauta", "caderno", 25.75, "Vitrine Didática"],
  ["Caneta Esferográfica Azul Ponta Fina", "Escrita leve", "caneta", 3.50, "Loja Alfa Exemplo"],
  ["Caneta Esferográfica Preta Caixa 10 Unidades", "Material de escritório", "caneta", 21.90, "Papelaria Modelo"],
  ["Caneta Gel Vermelha 0,7 mm", "Tinta gel", "caneta", 6.40, "Vitrine Didática"],
  ["Caneta Marca-Texto Amarela", "Ponta chanfrada", "caneta", 5.20, "Bazar de Teste"],
  ["Mochila Escolar Juvenil Azul", "Compartimento para cadernos", "mochila", 89.90, "Bazar de Teste"],
  ["Mochila Escolar com Rodinhas", "Para material escolar", "mochila", 149.00, "Loja Alfa Exemplo"],
  ["Mochila Executiva para Notebook", "Bolso acolchoado", "mochila", 129.90, "Tecnologia Exemplo"],
  ["Fone de Ouvido Bluetooth Dobrável", "Conexão sem fio", "fone de ouvido", 79.90, "Tecnologia Exemplo"],
  ["Fone de Ouvido com Fio P2", "Modelo intra-auricular", "fone de ouvido", 24.90, "Loja Beta Exemplo"],
  ["Fone de Ouvido Infantil Azul", "Volume limitado", "fone de ouvido", 49.90, "Bazar de Teste"],
  ["Fone de Ouvido Esportivo sem Fio", "Resistente a respingos", "fone de ouvido", 109.00, "Loja Beta Exemplo"],
  ["Mouse sem Fio Ergonômico", "Conexão USB", "mouse", 59.90, "Tecnologia Exemplo"],
  ["Mouse sem Fio Compacto", "Receptor USB", "mouse", 39.50, "Loja Beta Exemplo"],
  ["Mouse Gamer com Fio RGB", "Sensor óptico", "mouse", 84.90, "Tecnologia Exemplo"],
  ["Mouse Óptico USB Básico", "Uso diário", "mouse", 22.90, "Bazar de Teste"],
  ["Teclado Mecânico Compacto", "Teclas iluminadas", "teclado", 219.00, "Tecnologia Exemplo"],
  ["Teclado sem Fio Slim", "Conexão Bluetooth", "teclado", 99.90, "Loja Beta Exemplo"],
  ["Teclado USB Padrão Brasileiro", "Layout ABNT2", "teclado", 49.90, "Bazar de Teste"],
  ["Garrafa Térmica Inox 500 ml", "Para bebidas frias ou quentes", "garrafa", 64.90, "Loja Alfa Exemplo"],
  ["Garrafa de Água Infantil 400 ml", "Tampa com alça", "garrafa", 29.90, "Vitrine Didática"],
  ["Garrafa Esportiva 1 Litro", "Plástico reutilizável", "garrafa", 35.50, "Bazar de Teste"],
  ["Calculadora Científica Escolar", "Funções trigonométricas", "calculadora", 74.90, "Vitrine Didática"],
  ["Calculadora de Mesa 12 Dígitos", "Visor grande", "calculadora", 42.90, "Papelaria Modelo"],
  ["Calculadora de Bolso 8 Dígitos", "Compacta", "calculadora", 19.90, "Loja Alfa Exemplo"],
];

export const demoMarketProducts = examples.map(([title, description, category, price, seller], index) => {
  const number = String(index + 1).padStart(12, "0");
  return {
    id: `00000000-0000-4000-8000-${number}`,
    title, description, category, price, currency: "BRL", seller,
    source: "Catálogo fictício",
    imageUrl: index % 7 === 0 ? `https://example.com/imagens/catalogo-${index + 1}.jpg` : "",
    productUrl: `https://example.com/catalogo/produto-${index + 1}`,
  };
});
