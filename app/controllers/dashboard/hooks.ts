export const getLastMonth = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    0,
    23,
    59,
    59
  );
  return { start, end };
};

export const getThisMonth = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59
  );
  return { start, end };
};

export const getThisYear = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
  return { start, end };
};

export const getLastYear = () => {
  const now = new Date();
  const start = new Date(now.getFullYear() - 1, 0, 1);
  const end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
  return { start, end };
};

export const getThisWeek = () => {
  const now = new Date();
  const start = new Date(now.setDate(now.getDate() - now.getDay()));
  const end = new Date(now.setDate(now.getDate() - now.getDay() + 6));
  return { start, end };
};

export const getLastWeek = () => {
  const now = new Date();
  const start = new Date(now.setDate(now.getDate() - now.getDay() - 7));
  const end = new Date(now.setDate(now.getDate() - now.getDay()));
  return { start, end };
};
