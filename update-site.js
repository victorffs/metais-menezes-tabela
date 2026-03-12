const fs = require('fs');
const https = require('https');
const path = require('path');

const tokensPath = 'projects/price-list/bling-tokens.json';
let tokens = null;

function loadTokens() {
  if (!fs.existsSync(tokensPath)) {
    throw new Error('Token file not found.');
  }
  tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
}

function getAccessToken() {
  if (!tokens) {
    loadTokens();
  }
  return tokens.access_token;
}

// Regex to extract dimensions from product name: "Prateleira ... 122x23cm"
// Matches: "122x23cm" or "122x23"
const dimRegex = /(\d+)[xX](\d+)(?:cm)?/i;

async function fetchAllProducts(page = 1, allProducts = []) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.bling.com.br',
      path: `/Api/v3/produtos?nome=Prateleira&limite=100&pagina=${page}&criterio=2`, // criterio 2 = Última alteração? Or simple active.
      method: 'GET',
      headers: { 'Authorization': `Bearer ${getAccessToken()}` }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', async () => {
        if (res.statusCode !== 200) {
          console.error(`Failed to fetch page ${page}: ${res.statusCode} ${body}`);
          return resolve(allProducts);
        }
        
        const response = JSON.parse(body);
        if (response.data && response.data.length > 0) {
          const newProducts = response.data.filter(p => p.situacao === 'A'); // Only Active
          allProducts = allProducts.concat(newProducts);
          // If we got full page, try next (simple pagination logic)
          if (response.data.length === 100) {
            resolve(await fetchAllProducts(page + 1, allProducts));
          } else {
            resolve(allProducts);
          }
        } else {
          resolve(allProducts);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchStock(productIds) {
  // Bling allows fetching stock for up to 100 IDs at a time
  // Chunking logic
  const chunks = [];
  for (let i = 0; i < productIds.length; i += 50) {
    chunks.push(productIds.slice(i, i + 50));
  }

  const stockMap = {};

  for (const chunk of chunks) {
    await new Promise((resolve) => {
      // param format: idsProdutos[]=1&idsProdutos[]=2...
      const params = chunk.map(id => `idsProdutos[]=${id}`).join('&');
      const options = {
        hostname: 'www.bling.com.br',
        path: `/Api/v3/estoques/saldos?${params}`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${getAccessToken()}` }
      };
      
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
            if (res.statusCode === 200) {
                const data = JSON.parse(body).data;
                if (data) {
                    data.forEach(item => {
                        stockMap[item.produto.id] = item.saldoFisicoTotal;
                    });
                }
            }
            resolve();
        });
      });
      req.end();
    });
  }
  return stockMap;
}

async function run() {
  console.log('Fetching products...');
  const products = await fetchAllProducts();
  console.log(`Found ${products.length} products.`);

  const productIds = products.map(p => p.id);
  console.log('Fetching stock...');
  const stockMap = await fetchStock(productIds);
  console.log('Stock fetched.');

  // Process data for the table
  // Group by Depth (Profundidade)
  // Logic: 122x23cm -> Width 122, Depth 23.
  
  // Group by Dimensions to handle duplicates (different SKUs for same size)
  const aggregatedItems = {};

  products.forEach(p => {
    const match = p.nome.match(dimRegex);
    if (match) {
      const width = parseInt(match[1]);
      const depth = parseInt(match[2]);
      const dimKey = `${width}x${depth}`;
      const stock = stockMap[p.id] || 0;
      
      if (stock > 0) {
        if (aggregatedItems[dimKey]) {
          aggregatedItems[dimKey].qty += stock;
          // Optionally update price if different? Using the first one found or max price?
          // Let's keep the price of the first one encountered or max price to be safe.
          aggregatedItems[dimKey].price = Math.max(aggregatedItems[dimKey].priceValue, p.preco);
          aggregatedItems[dimKey].priceFormatted = `$ ${aggregatedItems[dimKey].price}`;
        } else {
          aggregatedItems[dimKey] = {
            dim: `${width}cm x ${depth}cm`,
            width,
            depth,
            qty: stock,
            price: `$ ${p.preco}`,
            priceValue: p.preco,
            unit: true
          };
        }
      }
    }
  });

  const items = Object.values(aggregatedItems);

  // Sort by Depth, then Width
  items.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.width - b.width;
  });

  // Grouping logic (same as JS in HTML)
  // We need to group ranges like "20-23cm" or just exact depths.
  // Let's group by exact depth for simplicity, or create ranges if many near matches.
  // The user's list had "20-23cm", "25cm", "30cm"...
  
  const groups = {};
  items.forEach(item => {
    let key = `${item.depth}cm`;
    // Approximate grouping to match original style if needed, but exact is safer for auto.
    // Let's stick to exact depth groups, sorted.
    if (!groups[item.depth]) groups[item.depth] = { depth: key, items: [] };
    groups[item.depth].items.push(item);
  });

  const sortedGroups = Object.keys(groups).sort((a, b) => parseInt(a) - parseInt(b)).map(k => groups[k]);

  const htmlPath = 'projects/price-list/index.html';
  if (!fs.existsSync(htmlPath)) {
      console.error('HTML file not found.');
      return;
  }
  
  let html = fs.readFileSync(htmlPath, 'utf8');

  // Extract current data from HTML to compare
  const regex = /const data = \[([\s\S]*?)\];/m;
  const match = html.match(regex);
  const currentDataString = match ? `[${match[1]}]` : '[]';
  
  // Normalize strings for comparison (remove whitespace/newlines)
  const normalize = (str) => JSON.stringify(JSON.parse(str));
  
  const newDataJson = JSON.stringify(sortedGroups); // Already object structure
  
  // We need to compare the object structure.
  // Let's just compare the generated JSON strings.
  const dataString = JSON.stringify(sortedGroups, null, 2);
  
  let hasChanges = true;
  try {
      // Parse current JS array content to JSON to compare accurately
      // The content inside `const data = [...]` is valid JS/JSON.
      // However, it might have trailing commas or keys without quotes if manually edited (though I generate valid JSON).
      // Since I generate it with JSON.stringify, text comparison should work if format is stable.
      
      // Let's strip spaces from both to be safe.
      const s1 = currentDataString.replace(/\s/g, '');
      const s2 = JSON.stringify(sortedGroups).replace(/\s/g, '');
      
      if (s1 === s2) {
          hasChanges = false;
      }
  } catch (e) {
      console.log("Error comparing data, assuming changes present.");
  }

  if (!hasChanges) {
      console.log('No changes detected in stock/prices. Skipping update.');
      return;
  }

  console.log('Changes detected! Updating HTML...');
  
  if (regex.test(html)) {
      // Reconstruct the full variable definition
      const newScript = `const data = ${dataString};`;
      html = html.replace(regex, newScript);
      fs.writeFileSync(htmlPath, html);
      console.log('HTML updated successfully.');
      
      // Push changes
      try {
          // Changed to execute git commands from within the project directory
          const cmd = 'git add index.html && git commit -m "Auto-update stock via Bling API" && git push';
          require('child_process').execSync(cmd, { cwd: 'projects/price-list' });
          console.log('Git push successful.');
      } catch (e) {
          console.error('Git push failed:', e.message);
      }
  } else {
      console.error('Could not find data block in HTML.');
  }
}

// Check/Refresh token before running
// We can just run the refresh script logic here or require it
try {
    require('child_process').execSync('node projects/price-list/refresh-token.js', { stdio: 'inherit' });
    loadTokens();
    run();
} catch (e) {
    console.error("Failed to refresh token:", e.message);
    process.exit(1);
}
