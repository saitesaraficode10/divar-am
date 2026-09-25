(function () {
  var codes = [
    ['AM','Armenia','+374'],['IR','Iran','+98'],['RU','Russia','+7'],['TR','Turkey','+90'],
    ['GE','Georgia','+995'],['AE','UAE','+971'],['DE','Germany','+49'],['US','USA','+1'],
    ['GB','UK','+44'],['FR','France','+33'],['IQ','Iraq','+964'],['AF','Afghanistan','+93']
  ];
  document.querySelectorAll('select[data-country-code]').forEach(function (sel) {
    if (sel.options.length > 1) return;
    var prefer = sel.getAttribute('data-prefer') || '+374';
    codes.forEach(function (x) {
      var o = document.createElement('option');
      o.value = x[2]; o.textContent = x[1] + ' (' + x[2] + ')';
      if (x[2] === prefer) o.selected = true;
      sel.appendChild(o);
    });
  });
  var main = document.getElementById('mainPhoto');
  if (main) {
    document.querySelectorAll('[data-thumb]').forEach(function (t) {
      t.addEventListener('click', function () {
        main.src = t.getAttribute('data-thumb');
        document.querySelectorAll('[data-thumb]').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
      });
    });
  }
})();
