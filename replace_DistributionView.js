const fs = require('fs');
let text = fs.readFileSync('c:/Users/hp/Downloads/100first/components/DistributionView.tsx', 'utf8');

// 1. Market Pulse Container
text = text.replace(
    '<div className="card bg-base-100 shadow-md border border-base-200">',
    '<div className="bg-white rounded-3xl border border-gray-100 shadow-minimal p-6 lg:p-8">'
);
text = text.replace(
    '<div className="card-body">',
    '<div>'
);
// 2. Market Pulse Stats
text = text.replaceAll(
    '<div key={idx} className="stat bg-base-200 rounded-xl p-4 flex flex-col justify-between">',
    '<div key={idx} className="bg-gray-50 border border-gray-100 rounded-2xl p-5 flex flex-col justify-between">'
);
text = text.replaceAll(
    'className="stat-title text-[10px] font-bold uppercase opacity-60 min-h-[3rem] whitespace-normal break-words leading-tight mb-2"',
    'className="text-[10px] font-black uppercase tracking-widest text-gray-400 min-h-[2.5rem] whitespace-normal break-words leading-tight"'
);
text = text.replaceAll(
    'className="stat-value text-xl"',
    'className="text-2xl font-display font-medium text-brand-primary mt-2"'
);
text = text.replaceAll(
    'className="stat-desc text-success font-bold mt-1"',
    'className="text-[10px] uppercase font-bold text-amber-500 mt-1"'
);

// 3. Grid Cards
text = text.replaceAll(
    'className={`card bg-base-100 shadow-md hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer border ${selectedChannel?.name === channel.name ? \\'border-primary ring-1 ring-primary\\' : \\'border-base-200\\'}`}',
    'className={`bg-white rounded-3xl p-6 hover:-translate-y-1 hover:shadow-xl transition-all cursor-pointer border-2 ${selectedChannel?.name === channel.name ? \\'border-gray-900 shadow-lg\\' : \\'border-gray-100 shadow-minimal hover:border-gray-200\\'}`}'
);
text = text.replaceAll(
    '<div className="card-body p-6">',
    '<div>'
);
text = text.replaceAll(
    'badge badge-xs badge-primary badge-outline',
    'badge badge-xs bg-amber-100 text-amber-800 border-amber-200 font-bold'
);
text = text.replaceAll(
    'badge badge-xs badge-success text-white',
    'badge badge-xs bg-emerald-100 text-emerald-800 border-emerald-200 font-bold'
);
text = text.replaceAll(
    'badge badge-xs badge-neutral',
    'badge badge-xs bg-gray-100 text-gray-600 border-gray-200 font-bold'
);
text = text.replaceAll(
    'className="alert bg-base-200 py-2 px-3 text-xs"',
    'className="bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 text-xs text-gray-600 flex gap-2 items-start"'
);
text = text.replaceAll(
    'btn btn-sm btn-block btn-outline btn-primary',
    'w-full py-2.5 rounded-xl border-2 border-gray-100 text-xs font-bold text-gray-600 hover:bg-gray-900 hover:border-gray-900 hover:text-white transition-all'
);
text = text.replaceAll(
    '<div className="stats stats-vertical lg:stats-horizontal shadow bg-base-200 my-4 w-full">',
    '<div className="grid grid-cols-2 gap-2 bg-gray-50 rounded-2xl p-3 my-4 border border-gray-100">'
);
text = text.replaceAll(
    '<div className="stat p-2 place-items-center">',
    '<div className="flex flex-col items-center justify-center p-2 text-center">'
);
text = text.replaceAll(
    '<div className="radial-progress text-xs font-bold text-primary bg-base-100 border-4 border-base-100"',
    '<div className="radial-progress text-[10px] font-black text-white bg-gray-900 border-4 border-gray-900 shadow-lg"'
);
text = text.replaceAll(
    'className="text-xl font-bold mb-4 flex items-center gap-2"',
    'className="text-xl font-display font-bold mb-6 flex items-center gap-2 text-brand-primary"'
);
text = text.replaceAll(
    'text-primary',
    'text-gray-900'
);
text = text.replaceAll(
    'text-secondary',
    'text-amber-500'
);

fs.writeFileSync('c:/Users/hp/Downloads/100first/components/DistributionView.tsx', text);
