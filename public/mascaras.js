document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".money_mask").forEach((el) => {
    IMask(el, {
      mask: Number,
      scale: 2,
      signed: false,
      thousandsSeparator: ".",
      padFractionalZeros: true,
      normalizeZeros: true,
      radix: ",",
      mapToRadix: ["."],
    });
  });
});
