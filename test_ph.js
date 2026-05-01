const token = 'bnX8G_YiHhKtj2LcIiYagfFS7lVdzNN8B6yU0Lc4pHA';
fetch('https://api.producthunt.com/v2/api/graphql', {
    method: 'POST',
    headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: '{ __type(name: "Query") { fields { name } } }' })
})
    .then(r => r.json())
    .then(r => console.log(r.data.__type.fields.map(f => f.name).join(', ')))
    .catch(console.error);
